/* ============================================================
   Photo Atlas optional accounts, saved sessions, and team billing.
   Clerk handles identity/organizations; photos always remain local.
   ============================================================ */

'use strict';

(function accountWorkspace() {
  const controls = document.getElementById('account-controls');
  const signInBtn = document.getElementById('account-sign-in-btn');
  const signedIn = document.getElementById('account-signed-in');
  const userButtonNode = document.getElementById('account-user-button');
  const orgSwitcherNode = document.getElementById('organization-switcher');
  const workspaceBtn = document.getElementById('account-workspace-btn');
  const cloudSaveBtn = document.getElementById('save-cloud-draft-btn');
  const modal = document.getElementById('account-modal');
  const modalClose = document.getElementById('account-modal-close');
  const workspaceLabel = document.getElementById('account-workspace-label');
  const saveCurrentBtn = document.getElementById('account-save-current-btn');
  const sessionList = document.getElementById('account-session-list');
  const statusEl = document.getElementById('account-status');
  const billingCopy = document.getElementById('account-billing-copy');
  const teamCheckoutBtn = document.getElementById('account-team-checkout-btn');
  const billingPortalBtn = document.getElementById('account-billing-portal-btn');

  if (!controls || !modal) return;

  let config = null;
  let clerk = null;
  let componentsMounted = false;
  let activeDraftId = null;
  let lastWorkspaceKey = '';
  let accountRefreshTimer = null;

  function randomRequestId() {
    if (crypto.randomUUID) return crypto.randomUUID();
    const bytes = crypto.getRandomValues(new Uint8Array(18));
    return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  }

  function setStatus(message, error = false) {
    if (!message) {
      statusEl.classList.add('hidden');
      statusEl.classList.remove('error');
      statusEl.textContent = '';
      return;
    }
    statusEl.textContent = message;
    statusEl.classList.remove('hidden');
    statusEl.classList.toggle('error', error);
  }

  async function loadClerkScript() {
    window.__clerk_publishable_key = config.clerkPublishableKey;
    await new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/@clerk/clerk-js@6.25.13/dist/clerk.browser.js';
      script.async = true;
      script.crossOrigin = 'anonymous';
      script.dataset.clerkPublishableKey = config.clerkPublishableKey;
      script.onload = resolve;
      script.onerror = () => reject(new Error('Could not load account sign-in.'));
      document.head.appendChild(script);
    });
    clerk = window.Clerk;
    if (!clerk) throw new Error('Account sign-in did not initialize.');
    await clerk.load({
      appearance: {
        variables: {
          colorPrimary: '#BF9555',
          colorBackground: '#1E2430',
          colorText: '#FFFFFF',
          colorTextSecondary: '#A0A8B8',
          borderRadius: '8px'
        }
      }
    });
  }

  async function accountFetch(url, options = {}) {
    if (!clerk?.session) throw new Error('Sign in to continue.');
    const token = await clerk.session.getToken();
    const headers = new Headers(options.headers || {});
    headers.set('Authorization', `Bearer ${token}`);
    if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    const response = await fetch(url, { ...options, headers });
    if (response.status === 204) return null;
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
    return data;
  }

  function mountAccountComponents() {
    if (componentsMounted || !clerk?.user) return;
    try {
      clerk.mountUserButton(userButtonNode, { afterSignOutUrl: window.location.origin });
      clerk.mountOrganizationSwitcher(orgSwitcherNode, {
        hidePersonal: false,
        afterCreateOrganizationUrl: window.location.href,
        afterSelectOrganizationUrl: window.location.href,
        afterSelectPersonalUrl: window.location.href
      });
      componentsMounted = true;
    } catch (err) {
      console.warn('Company switcher unavailable:', err);
      orgSwitcherNode.classList.add('hidden');
    }
  }

  function updateSignedInUI() {
    const hasUser = !!clerk?.user;
    signInBtn.classList.toggle('hidden', hasUser);
    signedIn.classList.toggle('hidden', !hasUser);
    cloudSaveBtn?.classList.toggle('hidden', !hasUser);
    if (!hasUser) {
      closeModal();
      window.baSetTeamEntitlement?.(false);
      activeDraftId = null;
      lastWorkspaceKey = '';
      return;
    }
    mountAccountComponents();
    const workspaceKey = clerk.organization?.id || clerk.user.id;
    if (workspaceKey !== lastWorkspaceKey) {
      lastWorkspaceKey = workspaceKey;
      activeDraftId = null;
      scheduleAccountRefresh();
    }
  }

  function scheduleAccountRefresh() {
    clearTimeout(accountRefreshTimer);
    accountRefreshTimer = setTimeout(() => {
      refreshAccount().catch(err => console.warn('Account refresh failed:', err));
    }, 100);
  }

  function formatDate(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime())
      ? ''
      : new Intl.DateTimeFormat('en-CA', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
  }

  function renderSessions(drafts) {
    sessionList.replaceChildren();
    if (!drafts.length) {
      const empty = document.createElement('div');
      empty.className = 'account-session-empty';
      empty.textContent = 'No sessions saved in this workspace yet.';
      sessionList.appendChild(empty);
      return;
    }

    drafts.forEach(draft => {
      const item = document.createElement('div');
      item.className = 'account-session-item';

      const info = document.createElement('div');
      const title = document.createElement('div');
      title.className = 'account-session-title';
      title.textContent = draft.title || draft.projectName || 'Untitled Photo Atlas';
      const meta = document.createElement('div');
      meta.className = 'account-session-meta';
      meta.textContent = `${draft.photoCount || 0} photos · Updated ${formatDate(draft.updatedAt)}`;
      info.append(title, meta);

      const actions = document.createElement('div');
      actions.className = 'account-session-actions';
      const open = document.createElement('button');
      open.type = 'button';
      open.className = 'btn-ghost';
      open.textContent = 'Resume';
      open.addEventListener('click', () => resumeDraft(draft.id));
      actions.appendChild(open);
      if (draft.canDelete) {
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'btn-ghost account-session-delete';
        remove.textContent = 'Delete';
        remove.addEventListener('click', () => deleteDraft(draft));
        actions.appendChild(remove);
      }
      item.append(info, actions);
      sessionList.appendChild(item);
    });
  }

  async function refreshAccount() {
    if (!clerk?.user) return;
    const [account, sessions] = await Promise.all([
      accountFetch('/api/account'),
      accountFetch('/api/drafts')
    ]);
    const organization = clerk.organization;
    workspaceLabel.textContent = organization
      ? `${organization.name} company workspace`
      : 'Personal workspace';
    renderSessions(sessions.drafts || []);

    teamCheckoutBtn.classList.add('hidden');
    billingPortalBtn.classList.add('hidden');
    if (account.workspace.type === 'organization') {
      if (account.teamEntitled) {
        const end = account.currentPeriodEnd ? ` through ${formatDate(account.currentPeriodEnd)}` : '';
        billingCopy.textContent = `Company plan active${end}. Clean exports are included for current members.`;
        billingPortalBtn.classList.remove('hidden');
      } else {
        billingCopy.textContent = account.subscriptionStatus
          ? `Company plan status: ${account.subscriptionStatus}. An administrator can manage it in Stripe.`
          : 'One company plan can cover every employee invited to this workspace.';
        if (account.subscriptionStatus) billingPortalBtn.classList.remove('hidden');
        else if (config.teamBillingEnabled) teamCheckoutBtn.classList.remove('hidden');
      }
    } else {
      billingCopy.textContent = 'Use the company switcher above to create a firm workspace, invite employees, and set up shared billing.';
    }
    window.baSetTeamEntitlement?.(!!account.teamEntitled);
    if (!account.teamEntitled) await checkCurrentProjectEntitlement();
  }

  async function checkCurrentProjectEntitlement() {
    if (!clerk?.user) return false;
    const payment = window.baGetPaymentContext?.();
    if (!payment) return false;
    try {
      const result = await accountFetch('/api/account/project-entitlement', {
        method: 'POST',
        body: JSON.stringify(payment)
      });
      window.baApplyAccountProjectEntitlement?.(result);
      return !!result.entitled;
    } catch (err) {
      console.warn('Could not check saved purchase:', err);
      return false;
    }
  }

  async function saveCurrentSession() {
    const payload = window.baBuildCloudDraft?.();
    if (!payload) {
      setStatus('Select and extract photos before saving a session.', true);
      return;
    }
    setStatus('Saving session…');
    saveCurrentBtn.disabled = true;
    if (cloudSaveBtn) cloudSaveBtn.disabled = true;
    try {
      const endpoint = activeDraftId ? `/api/drafts/${activeDraftId}` : '/api/drafts';
      const result = await accountFetch(endpoint, {
        method: 'PUT',
        body: JSON.stringify(payload)
      });
      activeDraftId = result.draft.id;
      setStatus('Session saved. Photo files remain on this device.');
      await refreshAccount();
    } catch (err) {
      setStatus(err.message, true);
    } finally {
      saveCurrentBtn.disabled = false;
      if (cloudSaveBtn) cloudSaveBtn.disabled = false;
    }
  }

  async function resumeDraft(id) {
    setStatus('Loading session…');
    try {
      const saved = await accountFetch(`/api/drafts/${id}`);
      const loaded = window.baLoadCloudDraft?.(saved.draft, saved.title || 'saved session');
      if (loaded === false) {
        setStatus('Current workflow kept. Nothing was replaced.');
        return;
      }
      activeDraftId = id;
      closeModal();
      document.getElementById('step-1')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) {
      setStatus(err.message, true);
    }
  }

  async function deleteDraft(draft) {
    const name = draft.title || draft.projectName || 'this saved session';
    if (!window.confirm(`Delete ${name}? The original photos on your device will not be affected.`)) return;
    try {
      await accountFetch(`/api/drafts/${draft.id}`, { method: 'DELETE' });
      if (activeDraftId === draft.id) activeDraftId = null;
      setStatus('Saved session deleted.');
      await refreshAccount();
    } catch (err) {
      setStatus(err.message, true);
    }
  }

  function openModal() {
    if (!clerk?.user) return clerk?.openSignIn();
    modal.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    setStatus('');
    refreshAccount().catch(err => setStatus(err.message, true));
  }

  function closeModal() {
    modal.classList.add('hidden');
    document.body.style.overflow = '';
  }

  async function openStripeEndpoint(endpoint) {
    const stripeTab = window.open('', '_blank');
    const trigger = endpoint.includes('team-checkout') ? teamCheckoutBtn : billingPortalBtn;
    trigger.disabled = true;
    try {
      const result = await accountFetch(endpoint, {
        method: 'POST',
        body: endpoint.includes('team-checkout')
          ? JSON.stringify({ requestId: randomRequestId() })
          : JSON.stringify({})
      });
      if (!stripeTab) throw new Error('Please allow popups for Photo Atlas and try again.');
      stripeTab.location.href = result.url;
    } catch (err) {
      stripeTab?.close();
      setStatus(err.message, true);
    } finally {
      trigger.disabled = false;
    }
  }

  async function init() {
    try {
      const response = await fetch('/api/config');
      config = await response.json();
      if (!response.ok || !config.accountsEnabled || !config.clerkPublishableKey) return;
      controls.classList.remove('hidden');
      await loadClerkScript();
      clerk.addListener(updateSignedInUI);
      updateSignedInUI();

      const params = new URLSearchParams(window.location.search);
      if (params.has('team_checkout')) {
        const outcome = params.get('team_checkout');
        const clean = new URL(window.location.href);
        clean.searchParams.delete('team_checkout');
        window.history.replaceState({}, '', clean.toString());
        if (outcome === 'success' && clerk.user) {
          openModal();
          setStatus('Company checkout completed. Stripe is confirming the plan now.');
          setTimeout(() => refreshAccount().catch(() => {}), 1800);
        }
      }
    } catch (err) {
      console.warn('Optional accounts unavailable:', err);
      controls.classList.add('hidden');
    }
  }

  signInBtn.addEventListener('click', () => clerk?.openSignIn());
  workspaceBtn.addEventListener('click', openModal);
  cloudSaveBtn?.addEventListener('click', saveCurrentSession);
  saveCurrentBtn.addEventListener('click', saveCurrentSession);
  modalClose.addEventListener('click', closeModal);
  modal.addEventListener('click', event => { if (event.target === modal) closeModal(); });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !modal.classList.contains('hidden')) closeModal();
  });
  window.addEventListener('ba:new-project', () => { activeDraftId = null; });
  teamCheckoutBtn.addEventListener('click', () => openStripeEndpoint('/api/billing/team-checkout'));
  billingPortalBtn.addEventListener('click', () => openStripeEndpoint('/api/billing/portal'));

  window.baAccounts = {
    accountFetch,
    checkCurrentProjectEntitlement,
    isSignedIn: () => !!clerk?.user,
    refreshAccount,
    saveCurrentSession
  };

  init();
})();
