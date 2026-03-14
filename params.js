const backendUrl = getWebAppBackendUrl('');

// State
let currentConfig = {};
let presetsData = {};       // key -> preset (from server)
let editingPresetKey = '';  // key being edited, or '__new__' for new

// Derive the public base URL from backendUrl (which Dataiku provides correctly)
// backendUrl looks like "/web-apps-backends/PROJECT/WEBAPP_ID/" — we need the full origin + path without trailing slash
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
// Mode switching (inside editor)
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
// Preset List (OAuth tab)
// ============================================================

function slugify(name) {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').substring(0, 40) || 'preset';
}

const MODE_LABELS = { builtin: 'Built-in', external: 'External IdP', direct: 'Direct OAuth' };

async function loadPresets() {
    try {
        const resp = await fetch(backendUrl + 'admin/presets');
        presetsData = await resp.json();
        renderPresetList();
        populateActivePresetDropdown();
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
        const activeBadge = p.is_active ? '<span class="badge badge-ok">active</span>' : '';
        const authBadge = p.oauth_enabled
            ? '<span class="badge badge-mode">' + modeLabel + '</span>'
            : '<span class="badge badge-warn">auth off</span>';
        const deleteBtn = p.is_active
            ? ''
            : `<button onclick="deletePreset('${key}')" class="btn-small btn-danger">Delete</button>`;

        return `
            <div class="preset-row ${p.is_active ? 'preset-active' : ''}">
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

function populateActivePresetDropdown() {
    const select = document.getElementById('active-preset-select');
    const activeKey = currentConfig.active_preset || '';
    select.innerHTML = '';

    Object.keys(presetsData).forEach(key => {
        const p = presetsData[key];
        const opt = document.createElement('option');
        opt.value = key;
        opt.textContent = p.name || key;
        select.appendChild(opt);
    });

    // Add a "None (no auth)" option
    const noneOpt = document.createElement('option');
    noneOpt.value = '';
    noneOpt.textContent = 'None (no auth)';
    select.appendChild(noneOpt);

    select.value = activeKey;
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
        // Avoid collisions
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
    if (preset && preset.is_active) {
        showSaveStatus('Cannot delete the active preset', 'red');
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
// Server Config Tab (agent + active preset)
// ============================================================

async function saveServerConfig() {
    const selectedPresetKey = document.getElementById('active-preset-select').value;

    // Save agent config (don't overwrite base_url — it's set correctly in project vars)
    const config = {
        agent: {
            project_key: document.getElementById('agent-project').value.trim(),
            tool_ids: Array.from(document.querySelectorAll('#tools-list input[type="checkbox"]:checked'))
                .map(cb => cb.value)
        }
    };

    try {
        // Save agent config
        const resp = await fetch(backendUrl + 'admin/config', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(config)
        });
        const result = await resp.json();

        if (result.status !== 'ok') {
            showSaveStatus('Save failed', 'red');
            return;
        }

        // Activate selected preset
        if (selectedPresetKey && selectedPresetKey !== currentConfig.active_preset) {
            await fetch(backendUrl + 'admin/presets/' + encodeURIComponent(selectedPresetKey) + '/activate', {
                method: 'POST'
            });
        }

        showSaveStatus('Saved — changes are live now', 'green');
        currentConfig.agent = config.agent;
        currentConfig.base_url = config.base_url;
        currentConfig.active_preset = selectedPresetKey;
        await loadPresets();
        await refreshHealth();
    } catch (e) {
        showSaveStatus('Error: ' + e.message, 'red');
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

        // Load presets (renders list + populates dropdown)
        await loadPresets();

        // If no presets exist, seed defaults
        if (Object.keys(presetsData).length === 0) {
            await seedDefaultPresets();
        }

        // Populate agent config
        document.getElementById('agent-project').value = (currentConfig.agent || {}).project_key || '';
        if ((currentConfig.agent || {}).project_key) {
            loadAgentTools();
        }

        updateStatusPills(health);
        updateConnectionInfo();
        updateStatusBadge(health);
        updateChecklist(health);
    } catch (e) {
        document.getElementById('status-badge').className = 'badge badge-error';
        document.getElementById('status-badge').textContent = 'Error';
        console.error('Init error:', e);
    }
}

async function seedDefaultPresets() {
    // Create Built-in test preset
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

    // Create Entra ID example preset
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

    // Activate the builtin one by default
    await fetch(backendUrl + 'admin/presets/builtin-test/activate', { method: 'POST' });
    currentConfig.active_preset = 'builtin-test';

    await loadPresets();
}

async function refreshHealth() {
    try {
        const healthResp = await fetch(backendUrl + 'admin/health');
        const health = await healthResp.json();
        updateStatusPills(health);
        updateStatusBadge(health);
        updateChecklist(health);
        const configResp = await fetch(backendUrl + 'admin/config');
        currentConfig = await configResp.json();
    } catch (e) {
        console.error('Health refresh error:', e);
    }
}

function updateStatusPills(health) {
    // Agent pill
    const agentPill = document.getElementById('status-agent');
    agentPill.className = 'status-pill ' + (health.agent_configured ? 'pill-ok' : 'pill-off');
    agentPill.querySelector('.status-label').textContent = health.agent_configured ? 'Agent ready' : 'No agent';

    // OAuth pill
    const oauthPill = document.getElementById('status-oauth');
    oauthPill.className = 'status-pill ' + (health.oauth_enabled ? 'pill-ok' : 'pill-off');
    oauthPill.querySelector('.status-label').textContent = health.oauth_enabled ? 'OAuth on' : 'OAuth off';

    // Preset pill
    const presetPill = document.getElementById('status-preset');
    const presetName = document.getElementById('status-preset-name');
    if (health.preset_name) {
        presetPill.className = 'status-pill pill-ok';
        presetName.textContent = health.preset_name;
    } else {
        presetPill.className = 'status-pill pill-off';
        presetName.textContent = 'No preset';
    }
}

function updateStatusBadge(health) {
    const badge = document.getElementById('status-badge');
    if (health.status === 'running' && health.agent_configured && health.oauth_enabled) {
        badge.className = 'badge badge-ok';
        badge.textContent = 'Ready';
    } else if (health.status === 'running' && health.agent_configured) {
        badge.className = 'badge badge-warn';
        badge.textContent = 'No OAuth';
    } else if (health.status === 'running') {
        badge.className = 'badge badge-warn';
        badge.textContent = 'Needs Config';
    } else {
        badge.className = 'badge badge-error';
        badge.textContent = 'Error';
    }
}

function updateChecklist(health) {
    const checklist = document.getElementById('setup-checklist');
    const allDone = health.agent_configured && health.oauth_enabled;
    checklist.style.display = allDone ? 'none' : 'block';

    const checkAgent = document.getElementById('check-agent');
    checkAgent.className = 'checklist-item ' + (health.agent_configured ? 'check-done' : '');
    const checkOauth = document.getElementById('check-oauth');
    checkOauth.className = 'checklist-item ' + (health.oauth_enabled ? 'check-done' : '');
}

function updateConnectionInfo() {
    const mcpUrl = autoBaseUrl + '/mcp';

    // Hero URL
    document.getElementById('mcp-url').textContent = mcpUrl;

    // Client-specific URLs
    const urlDesktop = document.getElementById('url-claude-desktop');
    if (urlDesktop) urlDesktop.textContent = mcpUrl;
    const urlChatgpt = document.getElementById('url-chatgpt');
    if (urlChatgpt) urlChatgpt.textContent = mcpUrl;

    // Claude Code command
    const cmdEl = document.getElementById('claude-code-cmd');
    if (cmdEl) cmdEl.textContent = 'claude mcp add dataiku-mcp -- ' + mcpUrl;

    // Claude Code JSON config
    const clientConfig = {
        "mcpServers": {
            "dataiku-mcp": {
                "url": mcpUrl,
                "type": "http"
            }
        }
    };
    document.getElementById('client-config').textContent = JSON.stringify(clientConfig, null, 2);
}

// ============================================================
// Client tab switching (within Connection Info)
// ============================================================
document.querySelectorAll('.client-tab').forEach(tab => {
    tab.addEventListener('click', () => {
        document.querySelectorAll('.client-tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.client-panel').forEach(p => p.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById('client-' + tab.dataset.client).classList.add('active');
    });
});

// ============================================================
// Shared actions
// ============================================================

function copyUrl() {
    const url = document.getElementById('mcp-url').textContent;
    navigator.clipboard.writeText(url);
}

function copyCmdClaudeCode() {
    const cmd = document.getElementById('claude-code-cmd').textContent;
    navigator.clipboard.writeText(cmd);
}

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

async function loadAgentTools() {
    const projectKey = document.getElementById('agent-project').value.trim();
    if (!projectKey) return;

    const toolsList = document.getElementById('tools-list');
    toolsList.innerHTML = '<p class="help">Loading...</p>';

    try {
        const resp = await fetch(backendUrl + 'admin/agents?project_key=' + encodeURIComponent(projectKey));
        const tools = await resp.json();

        if (tools.length === 0) {
            toolsList.innerHTML = '<p class="help">No agent tools found in this project.</p>';
            return;
        }

        const configuredTools = ((currentConfig.agent || {}).tool_ids || []);

        toolsList.innerHTML = tools.map(t => `
            <div class="tool-item">
                <input type="checkbox" id="tool-${t.tool_id}" value="${t.tool_id}"
                    ${configuredTools.includes(t.tool_id) ? 'checked' : ''}>
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

function showSaveStatus(msg, color) {
    ['save-status', 'save-status-agent'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.textContent = msg;
            el.style.color = color;
            setTimeout(() => { el.textContent = ''; }, 3000);
        }
    });
}

// Expose functions (Dataiku wraps JS in IIFE)
window.copyUrl = copyUrl;
window.copyCmdClaudeCode = copyCmdClaudeCode;
window.discoverEndpoints = discoverEndpoints;
window.loadAgentTools = loadAgentTools;
window.savePreset = savePreset;
window.saveServerConfig = saveServerConfig;
window.deletePreset = deletePreset;
window.editPreset = editPreset;
window.openNewPreset = openNewPreset;
window.closeEditor = closeEditor;
window.setOAuthMode = setOAuthMode;

// Start
init();
