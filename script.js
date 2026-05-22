document.getElementById('extract-btn').addEventListener('click', extractExifData);
document.getElementById('download-csv').addEventListener('click', downloadCSV);
document.getElementById('download-geojson').addEventListener('click', downloadGeoJSON);

async function extractExifData() {
    const files = document.getElementById('file-input').files;
    const folderPath = document.getElementById('folder-path').value;
    const tbody = document.getElementById('exif-table').querySelector('tbody');
    tbody.innerHTML = '';
    const allExifKeys = new Set();
    let photoNumber = 1;

    const exifDataArray = await Promise.all(Array.from(files).map(async (file) => {
        if (!file.type.startsWith('image/')) {
            return null;
        }
        try {
            const exifData = await exifr.parse(file, true);
            for (const key in exifData) {
                allExifKeys.add(key);
            }
            const date = getPhotoTakenDate(exifData);
            const formattedDate = date ? formatDate(date) : '';
            const absolutePath = folderPath ? `${folderPath}/${file.webkitRelativePath.replace(/^.*[\\\/]/, '')}` : file.webkitRelativePath;
            return {
                photoNumber: photoNumber++,
                fileName: file.name,
                date: formattedDate,
                comment: '',
                path: absolutePath,
                ...exifData
            };
        } catch (error) {
            console.error(`Error parsing EXIF data for file ${file.name}:`, error);
            return null;
        }
    }));

    const filteredExifData = exifDataArray.filter(data => data !== null);

    if (filteredExifData.length === 0) {
        alert('No valid image files selected.');
        return;
    }

    const headers = ['photoNumber', 'fileName', 'date', 'comment', 'path', ...Array.from(allExifKeys).sort()];
    const thead = document.getElementById('table-headers');
    thead.innerHTML = '';
    headers.forEach(header => {
        const th = document.createElement('th');
        th.textContent = header;
        thead.appendChild(th);
    });

    filteredExifData.forEach(data => {
        const tr = document.createElement('tr');
        headers.forEach(header => {
            const td = document.createElement('td');
            td.textContent = data[header] || '';
            tr.appendChild(td);
        });
        tbody.appendChild(tr);
    });
}

function getPhotoTakenDate(exifData) {
    const dateTags = ['DateTimeOriginal', 'CreateDate', 'DateCreated'];
    for (const tag of dateTags) {
        if (exifData[tag]) {
            return exifData[tag];
        }
    }
    return null;
}

function formatDate(date) {
    const options = { day: '2-digit', month: 'short', year: 'numeric' };
    return new Date(date).toLocaleDateString('en-GB', options).replace(/ /g, '-');
}

function downloadCSV() {
    const table = document.getElementById('exif-table');
    const rows = Array.from(table.querySelectorAll('tr'));
    const csvContent = rows.map(row => {
        const cols = Array.from(row.querySelectorAll('th, td'));
        return cols.map(col => col.textContent).join(',');
    }).join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'exif_data.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}

async function downloadGeoJSON() {
    const exifData = getExifData();
    const geoJson = exifDataToGeoJson(exifData);

    const blob = new Blob([JSON.stringify(geoJson)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'exif_data.geojson';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}

function exifDataToGeoJson(exifData) {
    const features = exifData.map(data => {
        const longitude = parseFloat(data.longitude);
        const latitude = parseFloat(data.latitude);

        if (isNaN(longitude) || isNaN(latitude)) {
            return null;
        }

        return {
            type: "Feature",
            properties: { ...data },
            geometry: {
                type: "Point",
                coordinates: [longitude, latitude]
            }
        };
    }).filter(feature => feature !== null);

    return {
        type: "FeatureCollection",
        features: features
    };
}

function getExifData() {
    const table = document.getElementById('exif-table');
    const rows = Array.from(table.querySelectorAll('tbody tr'));
    const headers = Array.from(table.querySelectorAll('th')).map(th => th.textContent);

    return rows.map(row => {
        const cols = Array.from(row.querySelectorAll('td'));
        const data = {};
        cols.forEach((col, index) => {
            data[headers[index]] = col.textContent;
        });
        return data;
    });
}
