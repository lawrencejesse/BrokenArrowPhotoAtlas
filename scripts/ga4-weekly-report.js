const { execFileSync } = require('child_process');
const path = require('path');

const PROPERTY_ID = process.env.GA4_PROPERTY_ID || '542609499';
const GOOGLE_ACCOUNT = process.env.GA4_GOOGLE_ACCOUNT || 'jesse@brokenarrow.pro';
const SERVICE_ACCOUNT =
  process.env.GA4_SERVICE_ACCOUNT ||
  'photo-atlas-weekly-reporting@brokenarrowrpi.iam.gserviceaccount.com';
const API_ROOT = `https://analyticsdata.googleapis.com/v1beta/properties/${PROPERTY_ID}`;

const FUNNEL_EVENTS = [
  'photos_selected',
  'exif_extracted',
  'deliverable_generated',
  'begin_checkout',
  'purchase',
  'printable_html_downloaded',
  'geojson_downloaded',
  'review_draft_downloaded',
  'generation_failed',
];

function gcloudPath() {
  if (process.env.GCLOUD_PATH) return process.env.GCLOUD_PATH;
  if (process.platform !== 'win32') return 'gcloud';
  return path.join(
    process.env.LOCALAPPDATA || '',
    'Google',
    'Cloud SDK',
    'google-cloud-sdk',
    'bin',
    'gcloud.cmd'
  );
}

function userAccessToken() {
  const tokenArgs = ['auth', 'print-access-token', `--account=${GOOGLE_ACCOUNT}`];
  const executable = process.platform === 'win32' ? process.env.ComSpec || 'cmd.exe' : gcloudPath();
  const args =
    process.platform === 'win32'
      ? ['/d', '/c', 'call', gcloudPath(), ...tokenArgs]
      : tokenArgs;

  try {
    return execFileSync(
      executable,
      args,
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
    ).trim();
  } catch (error) {
    const detail = error.stderr?.toString().trim();
    throw new Error(
      `Could not read the local Google login for ${GOOGLE_ACCOUNT}.${detail ? ` ${detail}` : ''}`
    );
  }
}

async function analyticsAccessToken() {
  const response = await fetch(
    `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${encodeURIComponent(SERVICE_ACCOUNT)}:generateAccessToken`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${userAccessToken()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        scope: ['https://www.googleapis.com/auth/analytics.readonly'],
        lifetime: '3600s',
      }),
    }
  );

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Could not mint the short-lived GA4 Viewer token (${response.status}): ${detail}`);
  }

  const credentials = await response.json();
  return credentials.accessToken;
}

async function runReport(token, body) {
  const response = await fetch(`${API_ROOT}:runReport`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`GA4 Data API returned ${response.status}: ${detail}`);
  }

  return response.json();
}

function metricMap(report) {
  const names = (report.metricHeaders || []).map((header) => header.name);
  const values = report.rows?.[0]?.metricValues || [];
  return Object.fromEntries(names.map((name, index) => [name, Number(values[index]?.value || 0)]));
}

function rowsByDimension(report) {
  const metricNames = (report.metricHeaders || []).map((header) => header.name);
  return (report.rows || []).map((row) => ({
    dimension: row.dimensionValues?.[0]?.value || '(not set)',
    metrics: Object.fromEntries(
      metricNames.map((name, index) => [name, Number(row.metricValues?.[index]?.value || 0)])
    ),
  }));
}

function rowsWithDimensions(report) {
  const dimensionNames = (report.dimensionHeaders || []).map((header) => header.name);
  const metricNames = (report.metricHeaders || []).map((header) => header.name);
  return (report.rows || []).map((row) => ({
    dimensions: Object.fromEntries(
      dimensionNames.map((name, index) => [name, row.dimensionValues?.[index]?.value || '(not set)'])
    ),
    metrics: Object.fromEntries(
      metricNames.map((name, index) => [name, Number(row.metricValues?.[index]?.value || 0)])
    ),
  }));
}

function percent(numerator, denominator) {
  if (!denominator) return 'n/a';
  return `${((numerator / denominator) * 100).toFixed(1)}%`;
}

function delta(current, previous) {
  if (!previous) return current ? 'new' : '0.0%';
  const value = ((current - previous) / previous) * 100;
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`;
}

function formatMoney(value) {
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(value || 0);
}

async function main() {
  const token = await analyticsAccessToken();
  const dateRanges = [
    { startDate: '7daysAgo', endDate: 'yesterday', name: 'current' },
    { startDate: '14daysAgo', endDate: '8daysAgo', name: 'previous' },
  ];

  const [summary, funnel, sources, devices, leads] = await Promise.all([
    runReport(token, {
      dateRanges: [dateRanges[0]],
      metrics: ['activeUsers', 'newUsers', 'sessions', 'eventCount', 'totalRevenue'].map((name) => ({ name })),
    }),
    runReport(token, {
      dateRanges,
      dimensions: [{ name: 'eventName' }],
      metrics: [{ name: 'eventCount' }, { name: 'totalUsers' }],
      dimensionFilter: {
        filter: {
          fieldName: 'eventName',
          inListFilter: { values: FUNNEL_EVENTS },
        },
      },
      orderBys: [{ metric: { metricName: 'eventCount' }, desc: true }],
    }),
    runReport(token, {
      dateRanges: [dateRanges[0]],
      dimensions: [{ name: 'sessionSourceMedium' }],
      metrics: [{ name: 'sessions' }, { name: 'activeUsers' }],
      orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
      limit: 8,
    }),
    runReport(token, {
      dateRanges: [dateRanges[0]],
      dimensions: [{ name: 'deviceCategory' }],
      metrics: [{ name: 'activeUsers' }, { name: 'sessions' }],
      orderBys: [{ metric: { metricName: 'activeUsers' }, desc: true }],
    }),
    runReport(token, {
      dateRanges: [dateRanges[0]],
      dimensions: [{ name: 'sessionManualAdContent' }, { name: 'eventName' }],
      metrics: [{ name: 'eventCount' }, { name: 'totalUsers' }],
      dimensionFilter: {
        andGroup: {
          expressions: [
            {
              filter: {
                fieldName: 'sessionManualAdContent',
                stringFilter: { matchType: 'BEGINS_WITH', value: 'lead_', caseSensitive: false },
              },
            },
            {
              filter: {
                fieldName: 'eventName',
                inListFilter: {
                  values: ['session_start', 'photos_selected', 'deliverable_generated', 'begin_checkout', 'purchase'],
                },
              },
            },
          ],
        },
      },
    }),
  ]);

  const current = metricMap({ ...summary, rows: summary.rows ? [summary.rows[0]] : [] });
  const previous = metricMap({ ...summary, rows: summary.rows ? [summary.rows[1]] : [] });

  const funnelRows = rowsByDimension(funnel);
  const funnelValues = Object.fromEntries(
    FUNNEL_EVENTS.map((event) => {
      const row = funnelRows.find((item) => item.dimension === event);
      return [event, row?.metrics.eventCount || 0];
    })
  );

  const generated = funnelValues.deliverable_generated;
  const checkout = funnelValues.begin_checkout;
  const purchases = funnelValues.purchase;

  console.log('# Photo Atlas Weekly Analytics');
  console.log('');
  console.log('Period: the seven complete days ending yesterday, compared with the prior seven days.');
  console.log('');
  console.log('## Audience');
  console.log(`- Active users: ${current.activeUsers || 0} (${delta(current.activeUsers || 0, previous.activeUsers || 0)})`);
  console.log(`- New users: ${current.newUsers || 0} (${delta(current.newUsers || 0, previous.newUsers || 0)})`);
  console.log(`- Sessions: ${current.sessions || 0} (${delta(current.sessions || 0, previous.sessions || 0)})`);
  console.log('');
  console.log('## Product funnel');
  console.log(`- Selected photos: ${funnelValues.photos_selected}`);
  console.log(`- Generated a deliverable: ${generated}`);
  console.log(`- Started checkout: ${checkout} (${percent(checkout, generated)} of generated deliverables)`);
  console.log(`- Purchased: ${purchases} (${percent(purchases, checkout)} of checkouts; ${percent(purchases, generated)} of generated deliverables)`);
  console.log(`- Generation failures: ${funnelValues.generation_failed}`);
  console.log(`- Printable HTML downloads: ${funnelValues.printable_html_downloaded}`);
  console.log(`- GeoJSON downloads: ${funnelValues.geojson_downloaded}`);
  console.log(`- Review draft saves: ${funnelValues.review_draft_downloaded}`);
  console.log(`- GA4-reported revenue: ${formatMoney(current.totalRevenue)}`);
  console.log('');
  console.log('## Traffic sources');
  for (const row of rowsByDimension(sources)) {
    console.log(`- ${row.dimension}: ${row.metrics.sessions} sessions, ${row.metrics.activeUsers} users`);
  }
  console.log('');
  console.log('## Devices');
  for (const row of rowsByDimension(devices)) {
    console.log(`- ${row.dimension}: ${row.metrics.activeUsers} users, ${row.metrics.sessions} sessions`);
  }
  console.log('');
  console.log('## Direct lead links');
  const leadRows = rowsWithDimensions(leads);
  if (!leadRows.length) {
    console.log('- No tagged lead visits this week.');
  } else {
    const leadTokens = [...new Set(leadRows.map((row) => row.dimensions.sessionManualAdContent))];
    for (const token of leadTokens) {
      const events = Object.fromEntries(
        leadRows
          .filter((row) => row.dimensions.sessionManualAdContent === token)
          .map((row) => [row.dimensions.eventName, row.metrics.eventCount])
      );
      console.log(
        `- ${token}: ${events.session_start || 0} visits, ${events.photos_selected || 0} photo selections, ` +
          `${events.deliverable_generated || 0} deliverables, ${events.begin_checkout || 0} checkouts, ${events.purchase || 0} purchases`
      );
    }
  }
  console.log('');
  console.log('Note: GA4 is directional product analytics, not the payment ledger. Stripe remains the source of truth for revenue and successful payments.');
}

main().catch((error) => {
  console.error(`Weekly analytics report failed: ${error.message}`);
  process.exitCode = 1;
});
