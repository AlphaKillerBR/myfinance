/*
 * drive.js — sincronização de backup com o Google Drive do próprio usuário.
 *
 * Usa o escopo "drive.file", que só dá acesso a arquivos criados pelo
 * próprio app (não ao Drive inteiro). Por isso não exige processo de
 * verificação do Google mesmo em produção — ideal para uso pessoal.
 *
 * Requer que CONFIG.GOOGLE_CLIENT_ID (em js/config.js) esteja preenchido
 * com um Client ID OAuth criado no Google Cloud Console (veja README.md).
 */

const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const BACKUP_FILENAME = 'financeapp-backup.json';

const DriveSync = {
  _tokenClient: null,
  _accessToken: null,
  _tokenExpiresAt: 0,

  isConfigured() {
    return typeof CONFIG !== 'undefined' && CONFIG.GOOGLE_CLIENT_ID && CONFIG.GOOGLE_CLIENT_ID !== 'SEU_CLIENT_ID_AQUI';
  },

  isConnected() {
    return !!localStorage.getItem('drive_connected');
  },

  lastSyncedAt() {
    const v = localStorage.getItem('drive_last_synced');
    return v ? Number(v) : null;
  },

  _ensureTokenClient() {
    if (this._tokenClient) return this._tokenClient;
    this._tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: CONFIG.GOOGLE_CLIENT_ID,
      scope: DRIVE_SCOPE,
      callback: () => {}, // sobrescrito a cada chamada de requestToken
    });
    return this._tokenClient;
  },

  async requestToken({ silent = false } = {}) {
    if (this._accessToken && Date.now() < this._tokenExpiresAt - 30000) {
      return this._accessToken;
    }
    return new Promise((resolve, reject) => {
      const client = this._ensureTokenClient();
      client.callback = (resp) => {
        if (resp.error) {
          reject(new Error(resp.error));
          return;
        }
        this._accessToken = resp.access_token;
        this._tokenExpiresAt = Date.now() + (resp.expires_in || 3600) * 1000;
        localStorage.setItem('drive_connected', '1');
        resolve(this._accessToken);
      };
      client.requestAccessToken({ prompt: silent ? '' : 'consent' });
    });
  },

  async connect() {
    await this.requestToken({ silent: false });
  },

  disconnect() {
    if (this._accessToken) {
      google.accounts.oauth2.revoke(this._accessToken, () => {});
    }
    this._accessToken = null;
    this._tokenExpiresAt = 0;
    localStorage.removeItem('drive_connected');
    localStorage.removeItem('drive_file_id');
    localStorage.removeItem('drive_last_synced');
  },

  async _findBackupFileId(token) {
    const cached = localStorage.getItem('drive_file_id');
    if (cached) return cached;
    const q = encodeURIComponent(`name='${BACKUP_FILENAME}' and trashed=false`);
    const res = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&spaces=drive&fields=files(id,name,modifiedTime)`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error('Falha ao buscar backup no Drive');
    const data = await res.json();
    if (data.files && data.files.length > 0) {
      localStorage.setItem('drive_file_id', data.files[0].id);
      return data.files[0].id;
    }
    return null;
  },

  async _createBackupFile(token, content) {
    const metadata = { name: BACKUP_FILENAME, mimeType: 'application/json' };
    const boundary = 'financeapp_boundary';
    const body =
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
      `--${boundary}\r\nContent-Type: application/json\r\n\r\n${content}\r\n` +
      `--${boundary}--`;
    const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body,
    });
    if (!res.ok) throw new Error('Falha ao criar backup no Drive');
    const data = await res.json();
    localStorage.setItem('drive_file_id', data.id);
    return data.id;
  },

  async _updateBackupFile(token, fileId, content) {
    const res = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: content,
    });
    if (!res.ok) {
      // Arquivo pode ter sido removido manualmente do Drive; limpa cache e recria.
      localStorage.removeItem('drive_file_id');
      throw new Error('Falha ao atualizar backup no Drive');
    }
  },

  async _downloadBackupFile(token, fileId) {
    const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error('Falha ao baixar backup do Drive');
    return res.json();
  },

  // Sincroniza: baixa o que estiver no Drive, faz merge (last-write-wins)
  // com os dados locais, e sobe o resultado consolidado de volta.
  async sync() {
    if (!this.isConfigured()) {
      throw new Error('Google Client ID não configurado (veja js/config.js)');
    }
    const token = await this.requestToken({ silent: this.isConnected() });
    let fileId = await this._findBackupFileId(token);

    if (fileId) {
      const remoteDataset = await this._downloadBackupFile(token, fileId);
      await DB.mergeDataset(remoteDataset);
    }

    const merged = await DB.exportAll();
    const content = JSON.stringify(merged);

    if (fileId) {
      await this._updateBackupFile(token, fileId, content);
    } else {
      fileId = await this._createBackupFile(token, content);
    }

    localStorage.setItem('drive_last_synced', String(Date.now()));
    return merged;
  },
};

window.DriveSync = DriveSync;
