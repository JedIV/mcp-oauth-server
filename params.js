const backendUrl = getWebAppBackendUrl('');

// State
let currentConfig = {};
let presetsData = {};       // key -> preset
let serversData = {};       // name -> server info
let editingPresetKey = '';  // key being edited, or '__new__'
let editingServerName = ''; // name being edited, or '__new__'

// Derive the public base URL
const autoBaseUrl = window.location.origin + backendUrl.replace(/\/$/, '');

// ============================================================
// Tab switching
// ============================================================
document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById('tab-' + tab.dataset.tab).classList.add('active');
    });
});

// ============================================================
// Mode switching (inside preset editor)
// ============================================================
function setOAuthMode(mode) {
    document.querySelectorAll('.mode-card').forEach(card => {
        card.classList.toggle('active', card.dataset.mode === mode);
    });
    const radio = document.querySelector(`input[name="oauth_mode"][value="${mode}"]`);
    if (radio) radio.checked = true;

    document.querySelectorAll('.mode-fields').forEach(el => { el.style.display = 'none'; });
    const fields = document.getElementById('fields-' + mode);
    if (fields) fields.style.display = 'block';
}

document.querySelectorAll('.mode-card').forEach(card => {
    card.addEventListener('click', () => {
        setOAuthMode(card.dataset.mode);
    });
});

// ============================================================
// Helpers
// ============================================================

function slugify(name) {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').substring(0, 40) || 'preset';
}

const MODE_LABELS = { builtin: 'Built-in', external: 'External IdP', direct: 'Direct OAuth' };

function getServerMcpUrl(serverName) {
    return autoBaseUrl + '/servers/' + serverName + '/mcp';
}

function showSaveStatus(msg, color) {
    ['save-status', 'save-status-server'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.textContent = msg;
            el.style.color = color;
            setTimeout(() => { el.textContent = ''; }, 3000);
        }
    });
}

// ============================================================
// Server List
// ============================================================

async function loadServers() {
    try {
        const resp = await fetch(backendUrl + 'admin/servers');
        serversData = await resp.json();
        renderServerList();
    } catch (e) {
        console.error('Failed to load servers:', e);
    }
}

function renderServerList() {
    const container = document.getElementById('servers-list');
    const names = Object.keys(serversData);

    if (names.length === 0) {
        container.innerHTML = '<p class="help">No servers yet. Click "+ New Server" to create one.</p>';
        return;
    }

    container.innerHTML = names.map(name => {
        const s = serversData[name];
        const agentBadge = s.agent_configured
            ? '<span class="badge badge-ok">agent ready</span>'
            : '<span class="badge badge-warn">no agent</span>';
        const oauthBadge = s.oauth_enabled
            ? '<span class="badge badge-mode">' + (MODE_LABELS[s.oauth_mode] || s.oauth_mode) + '</span>'
            : '<span class="badge badge-warn">no auth</span>';

        return `
            <div class="server-row">
                <div class="server-info">
                    <div class="server-name">${s.display_name || name}</div>
                    <div class="server-meta">
                        ${agentBadge} ${oauthBadge}
                        <span class="server-url-label">${s.mcp_url}</span>
                    </div>
                </div>
                <div class="server-row-actions">
                    <button onclick="editServer('${name}')" class="btn-small">Edit</button>
                    <button onclick="deleteServer('${name}')" class="btn-small btn-danger">Delete</button>
                </div>
            </div>`;
    }).join('');
}

// ============================================================
// Server Editor
// ============================================================

function openNewServer() {
    editingServerName = '__new__';
    document.getElementById('server-editor-title').textContent = 'New Server';
    document.getElementById('server-name').value = '';
    document.getElementById('server-name').disabled = false;
    document.getElementById('server-display-name').value = '';
    document.getElementById('server-preset-select').value = '';
    document.getElementById('server-agent-project').value = '';
    document.getElementById('server-tools-list').innerHTML = '<p class="help">Enter a project key and click Load Tools.</p>';
    document.getElementById('server-connection-info').style.display = 'none';
    populateServerPresetDropdown('');
    document.getElementById('server-editor').style.display = 'block';
    document.getElementById('server-editor').scrollIntoView({ behavior: 'smooth' });
}

function editServer(name) {
    const server = serversData[name];
    if (!server) return;

    editingServerName = name;
    document.getElementById('server-editor-title').textContent = 'Edit: ' + (server.display_name || name);
    document.getElementById('server-name').value = name;
    document.getElementById('server-name').disabled = true; // Can't rename
    document.getElementById('server-display-name').value = server.display_name || '';
    document.getElementById('server-agent-project').value = (server.agent || {}).project_key || '';

    populateServerPresetDropdown(server.active_preset || '');

    // Show connection info
    updateServerConnectionInfo(name);
    document.getElementById('server-connection-info').style.display = 'block';

    // Load tools if project is set
    if ((server.agent || {}).project_key) {
        loadServerAgentTools((server.agent || {}).tool_ids || []);
    } else {
        document.getElementById('server-tools-list').innerHTML = '<p class="help">Enter a project key and click Load Tools.</p>';
    }

    document.getElementById('server-editor').style.display = 'block';
    document.getElementById('server-editor').scrollIntoView({ behavior: 'smooth' });
}

function closeServerEditor() {
    document.getElementById('server-editor').style.display = 'none';
    editingServerName = '';
}

function populateServerPresetDropdown(activeKey) {
    const select = document.getElementById('server-preset-select');
    select.innerHTML = '<option value="">None (no auth)</option>';
    Object.keys(presetsData).forEach(key => {
        const p = presetsData[key];
        const opt = document.createElement('option');
        opt.value = key;
        opt.textContent = p.name || key;
        select.appendChild(opt);
    });
    select.value = activeKey;
}

function updateServerConnectionInfo(serverName) {
    const mcpUrl = getServerMcpUrl(serverName);
    document.getElementById('server-mcp-url').textContent = mcpUrl;

    const cmdEl = document.getElementById('server-claude-code-cmd');
    if (cmdEl) cmdEl.textContent = 'claude mcp add dataiku-' + serverName + ' -- ' + mcpUrl;

    const clientConfig = {
        "mcpServers": {
            ["dataiku-" + serverName]: {
                "url": mcpUrl,
                "type": "http"
            }
        }
    };
    const configEl = document.getElementById('server-client-config');
    if (configEl) configEl.textContent = JSON.stringify(clientConfig, null, 2);
}

async function loadServerAgentTools(preCheckedIds) {
    const projectKey = document.getElementById('server-agent-project').value.trim();
    if (!projectKey) return;

    const toolsList = document.getElementById('server-tools-list');
    toolsList.innerHTML = '<p class="help">Loading...</p>';

    // If called without preCheckedIds, try to get from current editing server
    if (!preCheckedIds) {
        if (editingServerName !== '__new__' && serversData[editingServerName]) {
            preCheckedIds = (serversData[editingServerName].agent || {}).tool_ids || [];
        } else {
            preCheckedIds = [];
        }
    }

    try {
        const resp = await fetch(backendUrl + 'admin/agents?project_key=' + encodeURIComponent(projectKey));
        const tools = await resp.json();

        if (tools.length === 0) {
            toolsList.innerHTML = '<p class="help">No agent tools found in this project.</p>';
            return;
        }

        toolsList.innerHTML = tools.map(t => `
            <div class="tool-item">
                <input type="checkbox" id="stool-${t.tool_id}" value="${t.tool_id}"
                    ${preCheckedIds.includes(t.tool_id) ? 'checked' : ''}>
                <div class="tool-info">
                    <div class="tool-name">${t.tool_name}</div>
                    <div class="tool-type">${t.tool_type} &middot; ${t.tool_id}</div>
                </div>
            </div>
        `).join('');
    } catch (e) {
        toolsList.innerHTML = '<p class="help">Error loading tools: ' + e.message + '</p>';
    }
}

async function saveServer() {
    let name;
    if (editingServerName === '__new__') {
        name = document.getElementById('server-name').value.trim();
        if (!name) {
            showSaveStatus('Server name is required', 'red');
            return;
        }
        if (!/^[a-z0-9][a-z0-9_-]*$/.test(name)) {
            showSaveStatus('Name must be lowercase letters, numbers, hyphens', 'red');
            return;
        }
    } else {
        name = editingServerName;
    }

    const serverData = {
        display_name: document.getElementById('server-display-name').value.trim() || name,
        active_preset: document.getElementById('server-preset-select').value,
        agent: {
            project_key: document.getElementById('server-agent-project').value.trim(),
            tool_ids: Array.from(document.querySelectorAll('#server-tools-list input[type="checkbox"]:checked'))
                .map(cb => cb.value)
        }
    };

    try {
        const resp = await fetch(backendUrl + 'admin/servers', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ name, server_data: serverData })
        });
        const result = await resp.json();

        if (result.status === 'ok') {
            showSaveStatus('Server saved!', 'green');
            editingServerName = name;
            document.getElementById('server-name').disabled = true;
            updateServerConnectionInfo(name);
            document.getElementById('server-connection-info').style.display = 'block';
            await loadServers();
            await refreshHealth();
        } else {
            showSaveStatus('Save failed: ' + (result.error || 'unknown error'), 'red');
        }
    } catch (e) {
        showSaveStatus('Error: ' + e.message, 'red');
    }
}

async function deleteServer(name) {
    const server = serversData[name];
    if (!confirm('Delete server "' + (server ? server.display_name : name) + '"? This removes the MCP endpoint.')) return;

    try {
        const resp = await fetch(backendUrl + 'admin/servers/' + encodeURIComponent(name), {
            method: 'DELETE'
        });
        const result = await resp.json();

        if (result.status === 'ok') {
            showSaveStatus('Server deleted', 'green');
            if (editingServerName === name) closeServerEditor();
            await loadServers();
            await refreshHealth();
        } else {
            showSaveStatus('Delete failed: ' + (result.error || 'unknown error'), 'red');
        }
    } catch (e) {
        showSaveStatus('Error: ' + e.message, 'red');
    }
}

function copyServerUrl() {
    const url = document.getElementById('server-mcp-url').textContent.replace(/\s+/g, '');
    navigator.clipboard.writeText(url);
}

function copyServerCmd() {
    const cmd = document.getElementById('server-claude-code-cmd').textContent.trim();
    navigator.clipboard.writeText(cmd);
}

// ============================================================
// Client tab switching (within server editor connection info)
// ============================================================
document.addEventListener('click', (e) => {
    const tab = e.target.closest('.client-tab');
    if (!tab) return;
    const parent = tab.closest('#server-connection-info');
    if (!parent) return;

    parent.querySelectorAll('.client-tab').forEach(t => t.classList.remove('active'));
    parent.querySelectorAll('.client-panel').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    const panelId = 'client-' + tab.dataset.client;
    const panel = document.getElementById(panelId);
    if (panel) panel.classList.add('active');
});

// ============================================================
// Preset List (OAuth tab)
// ============================================================

async function loadPresets() {
    try {
        const resp = await fetch(backendUrl + 'admin/presets');
        presetsData = await resp.json();
        renderPresetList();
    } catch (e) {
        console.error('Failed to load presets:', e);
    }
}

function renderPresetList() {
    const container = document.getElementById('presets-list');
    const keys = Object.keys(presetsData);

    if (keys.length === 0) {
        container.innerHTML = '<p class="help">No presets yet. Click "+ New Preset" to create one.</p>';
        return;
    }

    container.innerHTML = keys.map(key => {
        const p = presetsData[key];
        const modeLabel = MODE_LABELS[p.oauth_mode] || p.oauth_mode;
        const activeServers = (p.active_on_servers || []);
        const activeBadge = activeServers.length > 0
            ? '<span class="badge badge-ok">used by: ' + activeServers.join(', ') + '</span>'
            : '';
        const authBadge = p.oauth_enabled
            ? '<span class="badge badge-mode">' + modeLabel + '</span>'
            : '<span class="badge badge-warn">auth off</span>';
        const deleteBtn = activeServers.length > 0
            ? ''
            : `<button onclick="deletePreset('${key}')" class="btn-small btn-danger">Delete</button>`;

        return `
            <div class="preset-row ${activeServers.length > 0 ? 'preset-active' : ''}">
                <div class="preset-info">
                    <div class="preset-name">${p.name || key} ${activeBadge}</div>
                    <div class="preset-meta">${authBadge} <span class="preset-key-label">${key}</span></div>
                </div>
                <div class="preset-row-actions">
                    <button onclick="editPreset('${key}')" class="btn-small">Edit</button>
                    ${deleteBtn}
                </div>
            </div>`;
    }).join('');
}

// ============================================================
// Preset Editor
// ============================================================

function openNewPreset() {
    editingPresetKey = '__new__';
    document.getElementById('editor-title').textContent = 'New Preset';
    document.getElementById('preset-name').value = '';
    document.getElementById('oauth-enabled').checked = true;
    setOAuthMode('builtin');
    clearModeFields();
    document.getElementById('preset-editor').style.display = 'block';
    document.getElementById('preset-editor').scrollIntoView({ behavior: 'smooth' });
}

function editPreset(key) {
    const preset = presetsData[key];
    if (!preset) return;

    editingPresetKey = key;
    document.getElementById('editor-title').textContent = 'Edit: ' + (preset.name || key);
    document.getElementById('preset-name').value = preset.name || '';
    document.getElementById('oauth-enabled').checked = preset.oauth_enabled || false;

    const mode = preset.oauth_mode || 'builtin';
    setOAuthMode(mode);
    populatePresetFields(preset, mode);

    document.getElementById('preset-editor').style.display = 'block';
    document.getElementById('preset-editor').scrollIntoView({ behavior: 'smooth' });
}

function closeEditor() {
    document.getElementById('preset-editor').style.display = 'none';
    editingPresetKey = '';
}

function clearModeFields() {
    document.getElementById('ext-issuer-url').value = '';
    document.getElementById('ext-client-id').value = '';
    document.getElementById('ext-client-secret').value = '';
    document.getElementById('ext-scopes').value = '';
    document.getElementById('ext-secret-status').textContent = '';
    document.getElementById('direct-auth-server').value = '';
    document.getElementById('direct-introspection').value = '';
    document.getElementById('direct-client-id').value = '';
    document.getElementById('direct-client-secret').value = '';
    document.getElementById('direct-scopes').value = '';
    document.getElementById('direct-secret-status').textContent = '';
}

function populatePresetFields(preset, mode) {
    clearModeFields();
    if (mode === 'external') {
        document.getElementById('ext-issuer-url').value = preset.authorization_server || '';
        document.getElementById('ext-client-id').value = preset.client_id || '';
        document.getElementById('ext-scopes').value = (preset.scopes || ['mcp:tools']).join(' ');
        if (preset.has_client_secret) {
            document.getElementById('ext-secret-status').textContent = '(secret is set)';
        }
    } else if (mode === 'direct') {
        document.getElementById('direct-auth-server').value = preset.authorization_server || '';
        document.getElementById('direct-introspection').value = preset.introspection_endpoint || '';
        document.getElementById('direct-client-id').value = preset.client_id || '';
        document.getElementById('direct-scopes').value = (preset.scopes || ['mcp:tools']).join(' ');
        if (preset.has_client_secret) {
            document.getElementById('direct-secret-status').textContent = '(secret is set)';
        }
    }
}

function getSelectedMode() {
    const radio = document.querySelector('input[name="oauth_mode"]:checked');
    return radio ? radio.value : 'builtin';
}

function buildPresetData() {
    const mode = getSelectedMode();
    const preset = {
        name: document.getElementById('preset-name').value.trim() || _defaultPresetName(mode),
        oauth_enabled: document.getElementById('oauth-enabled').checked,
        oauth_mode: mode,
    };

    if (mode === 'builtin') {
        preset.scopes = ['mcp:tools'];
    } else if (mode === 'external') {
        preset.authorization_server = document.getElementById('ext-issuer-url').value.trim();
        preset.client_id = document.getElementById('ext-client-id').value.trim();
        preset.scopes = document.getElementById('ext-scopes').value.trim().split(/\s+/).filter(Boolean);
        const secret = document.getElementById('ext-client-secret').value;
        if (secret) preset.client_secret = secret;
    } else if (mode === 'direct') {
        preset.authorization_server = document.getElementById('direct-auth-server').value.trim();
        preset.introspection_endpoint = document.getElementById('direct-introspection').value.trim();
        preset.client_id = document.getElementById('direct-client-id').value.trim();
        preset.scopes = document.getElementById('direct-scopes').value.trim().split(/\s+/).filter(Boolean);
        const secret = document.getElementById('direct-client-secret').value;
        if (secret) preset.client_secret = secret;
    }

    return preset;
}

function _defaultPresetName(mode) {
    const names = { builtin: 'Built-in (Testing)', external: 'External IdP', direct: 'Direct OAuth 2.1' };
    return names[mode] || mode;
}

async function savePreset() {
    const presetData = buildPresetData();
    let key;

    if (editingPresetKey === '__new__') {
        key = slugify(presetData.name);
        if (presetsData[key]) {
            key = key + '-' + Date.now().toString(36).slice(-4);
        }
    } else {
        key = editingPresetKey;
    }

    try {
        const resp = await fetch(backendUrl + 'admin/presets', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ key, preset_data: presetData })
        });
        const result = await resp.json();

        if (result.status === 'ok') {
            showSaveStatus('Preset saved!', 'green');
            closeEditor();
            await loadPresets();
            await refreshHealth();
        } else {
            showSaveStatus('Save failed: ' + (result.error || 'unknown error'), 'red');
        }
    } catch (e) {
        showSaveStatus('Error: ' + e.message, 'red');
    }
}

async function deletePreset(key) {
    const preset = presetsData[key];
    if (preset && (preset.active_on_servers || []).length > 0) {
        showSaveStatus('Cannot delete: preset is used by servers', 'red');
        return;
    }
    if (!confirm('Delete preset "' + (preset ? preset.name : key) + '"?')) return;

    try {
        const resp = await fetch(backendUrl + 'admin/presets/' + encodeURIComponent(key), {
            method: 'DELETE'
        });
        const result = await resp.json();

        if (result.status === 'ok') {
            showSaveStatus('Preset deleted', 'green');
            if (editingPresetKey === key) closeEditor();
            await loadPresets();
        } else {
            showSaveStatus('Delete failed: ' + (result.error || 'unknown error'), 'red');
        }
    } catch (e) {
        showSaveStatus('Error: ' + e.message, 'red');
    }
}

// ============================================================
// Shared actions
// ============================================================

async function discoverEndpoints(mode) {
    let issuerInput;
    if (mode === 'external') {
        issuerInput = document.getElementById('ext-issuer-url');
    } else {
        issuerInput = document.getElementById('direct-auth-server');
    }

    const issuer = issuerInput.value.trim();
    if (!issuer) {
        issuerInput.focus();
        return;
    }

    try {
        const resp = await fetch(backendUrl + 'admin/discover', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({issuer_url: issuer})
        });
        const data = await resp.json();

        if (data.error) {
            showSaveStatus('Discovery failed: ' + data.error, 'red');
            return;
        }

        if (mode === 'direct' && data.introspection_endpoint) {
            document.getElementById('direct-introspection').value = data.introspection_endpoint;
        }

        showSaveStatus('Discovered endpoints successfully', 'green');
    } catch (e) {
        showSaveStatus('Discovery failed: ' + e.message, 'red');
    }
}

// ============================================================
// Health & Status
// ============================================================

async function refreshHealth() {
    try {
        const healthResp = await fetch(backendUrl + 'admin/health');
        const health = await healthResp.json();
        updateStatusBadge(health);
    } catch (e) {
        console.error('Health refresh error:', e);
    }
}

function updateStatusBadge(health) {
    const badge = document.getElementById('status-badge');
    const count = health.server_count || 0;

    if (health.status === 'running' && count > 0 && health.any_agent_configured && health.any_oauth_enabled) {
        badge.className = 'badge badge-ok';
        badge.textContent = count + ' server' + (count !== 1 ? 's' : '') + ' ready';
    } else if (health.status === 'running' && count > 0 && health.any_agent_configured) {
        badge.className = 'badge badge-warn';
        badge.textContent = count + ' server' + (count !== 1 ? 's' : '') + ' (no OAuth)';
    } else if (health.status === 'running' && count === 0) {
        badge.className = 'badge badge-warn';
        badge.textContent = 'No servers';
    } else if (health.status === 'running') {
        badge.className = 'badge badge-warn';
        badge.textContent = 'Needs config';
    } else {
        badge.className = 'badge badge-error';
        badge.textContent = 'Error';
    }
}

// ============================================================
// Init
// ============================================================
async function init() {
    try {
        const [configResp, healthResp] = await Promise.all([
            fetch(backendUrl + 'admin/config'),
            fetch(backendUrl + 'admin/health')
        ]);
        currentConfig = await configResp.json();
        const health = await healthResp.json();

        // Load presets first (needed by server editor dropdowns)
        await loadPresets();

        // If no presets exist, seed defaults
        if (Object.keys(presetsData).length === 0) {
            await seedDefaultPresets();
        }

        // Load servers + project keys for autocomplete
        await loadServers();
        loadProjectKeys();

        updateStatusBadge(health);
    } catch (e) {
        document.getElementById('status-badge').className = 'badge badge-error';
        document.getElementById('status-badge').textContent = 'Error';
        console.error('Init error:', e);
    }
}

async function seedDefaultPresets() {
    await fetch(backendUrl + 'admin/presets', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
            key: 'builtin-test',
            preset_data: {
                name: 'Built-in (Testing)',
                oauth_mode: 'builtin',
                oauth_enabled: true,
                scopes: ['mcp:tools']
            }
        })
    });

    await fetch(backendUrl + 'admin/presets', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
            key: 'entra-id-example',
            preset_data: {
                name: 'Entra ID (Example)',
                oauth_mode: 'external',
                oauth_enabled: true,
                authorization_server: 'https://login.microsoftonline.com/{your-tenant-id}/v2.0',
                client_id: '',
                scopes: ['api://{your-client-id}/mcp.tools']
            }
        })
    });

    await loadPresets();
}

// ============================================================
// Project key autocomplete
// ============================================================
async function loadProjectKeys() {
    try {
        const resp = await fetch(backendUrl + 'admin/project-keys');
        const keys = await resp.json();
        const datalist = document.getElementById('project-keys-list');
        datalist.innerHTML = keys.map(k => `<option value="${k}">`).join('');
    } catch (e) {
        console.error('Failed to load project keys:', e);
    }
}

// Expose functions (Dataiku wraps JS in IIFE)
window.copyServerUrl = copyServerUrl;
window.copyServerCmd = copyServerCmd;
window.discoverEndpoints = discoverEndpoints;
window.loadServerAgentTools = loadServerAgentTools;
window.savePreset = savePreset;
window.saveServer = saveServer;
window.deleteServer = deleteServer;
window.editServer = editServer;
window.openNewServer = openNewServer;
window.closeServerEditor = closeServerEditor;
window.deletePreset = deletePreset;
window.editPreset = editPreset;
window.openNewPreset = openNewPreset;
window.closeEditor = closeEditor;
window.setOAuthMode = setOAuthMode;

// Start
init();
