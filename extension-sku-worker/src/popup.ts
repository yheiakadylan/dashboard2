document.addEventListener('DOMContentLoaded', async () => {
    const teamIdInput = document.getElementById('teamId') as HTMLInputElement;
    const accountInput = document.getElementById('account') as HTMLInputElement;
    const dbEmailInput = document.getElementById('dbEmail') as HTMLInputElement;
    const dbPasswordInput = document.getElementById('dbPassword') as HTMLInputElement;
    const statusMsg = document.getElementById('statusMsg') as HTMLDivElement;
    
    // Load existing
    const data = (await chrome.storage.local.get(['teamId', 'account', 'dbEmail', 'dbPassword'])) as { [key: string]: string };
    if (data.teamId) teamIdInput.value = data.teamId;
    if (data.account) accountInput.value = data.account;
    if (data.dbEmail) dbEmailInput.value = data.dbEmail;
    if (data.dbPassword) dbPasswordInput.value = data.dbPassword;
    
    const saveBtn = document.getElementById('saveBtn') as HTMLButtonElement;
    
    // Auto show a soft connected status if data exists
    if (data.teamId && data.account && data.dbEmail && data.dbPassword) {
        statusMsg.textContent = 'Worker is ready for this Shop.';
        statusMsg.className = 'status success';
    }

    saveBtn.addEventListener('click', async () => {
        const teamId = teamIdInput.value.trim();
        const account = accountInput.value.trim();
        const dbEmail = dbEmailInput.value.trim();
        const dbPassword = dbPasswordInput.value.trim();
        
        if(!teamId || !account || !dbEmail || !dbPassword) {
            statusMsg.textContent = 'Vui lòng điền đầy đủ 4 trường!';
            statusMsg.className = 'status error';
            return;
        }
        
        saveBtn.disabled = true;
        saveBtn.textContent = 'Saving...';

        await chrome.storage.local.set({ teamId, account, dbEmail, dbPassword });
        
        statusMsg.textContent = 'Lưu thành công! Đang khởi động lại worker...';
        statusMsg.className = 'status success';
        
        // Wait 1.5s then reload so user can read the success message
        setTimeout(() => {
            saveBtn.textContent = 'Save & Connect';
            saveBtn.disabled = false;
            chrome.runtime.reload();
        }, 1500);
    });
});
