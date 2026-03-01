// API State
let authToken = localStorage.getItem('gfgpay_token') || null;
let currentUser = null;
let currentWallet = null;

const API_BASE = '/api/v1';

// DOM Elements
const authModal = document.getElementById('authModal');
const authForm = document.getElementById('authForm');
const registerForm = document.getElementById('registerForm');
const toggleAuthMode = document.getElementById('toggleAuthMode');
const authFooter = document.getElementById('authFooter');

const recentContactsEl = document.getElementById('recent-contacts');
const transactionListEl = document.getElementById('transactionList');
const transferForm = document.getElementById('transferForm');
const transferModal = document.getElementById('transferModal');

// Init
document.addEventListener('DOMContentLoaded', () => {
    if (authToken) {
        authModal.classList.remove('active');
        fetchDashboardData();
    } else {
        authModal.classList.add('active');
    }
});

// Auth Logic
let isLoginMode = true;
toggleAuthMode.addEventListener('click', (e) => {
    e.preventDefault();
    isLoginMode = !isLoginMode;
    if (isLoginMode) {
        authForm.style.display = 'block';
        registerForm.style.display = 'none';
        authFooter.innerHTML = `Don't have an account? <a href="#" id="toggleAuthMode" style="color: var(--primary);">Register</a>`;
        document.getElementById('toggleAuthMode').addEventListener('click', arguments.callee);
    } else {
        authForm.style.display = 'none';
        registerForm.style.display = 'block';
        authFooter.innerHTML = `Already have an account? <a href="#" id="toggleAuthMode" style="color: var(--primary);">Login</a>`;
        document.getElementById('toggleAuthMode').addEventListener('click', arguments.callee);
    }
});

authForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const phone = document.getElementById('authPhone').value;
    const password = document.getElementById('authPassword').value;

    try {
        const res = await fetch(`${API_BASE}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phoneNumber: phone, password })
        });
        const data = await res.json();
        
        if (data.success) {
            authToken = data.data.tokens.access.token;
            localStorage.setItem('gfgpay_token', authToken);
            authModal.classList.remove('active');
            fetchDashboardData();
        } else {
            alert(data.message || 'Login failed');
        }
    } catch (err) {
        console.error(err);
        alert('An error occurred during login');
    }
});

registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const firstName = document.getElementById('regFirstName').value;
    const lastName = document.getElementById('regLastName').value;
    const email = document.getElementById('regEmail').value;
    const phoneNumber = document.getElementById('regPhone').value;
    const password = document.getElementById('regPassword').value;

    try {
        const res = await fetch(`${API_BASE}/auth/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ firstName, lastName, email, phoneNumber, password })
        });
        const data = await res.json();
        
        if (data.success) {
            authToken = data.data.tokens.access.token;
            localStorage.setItem('gfgpay_token', authToken);
            authModal.classList.remove('active');
            
            // Set default PIN to allow transfers
            await fetch(`${API_BASE}/auth/pin/set`, {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${authToken}`
                },
                body: JSON.stringify({ pin: '1234', confirmPin: '1234' })
            });
            
            fetchDashboardData();
        } else {
            alert(data.message || 'Registration failed');
        }
    } catch (err) {
        console.error(err);
        alert('An error occurred during registration');
    }
});

// Logout
document.querySelector('.logout').addEventListener('click', (e) => {
    e.preventDefault();
    localStorage.removeItem('gfgpay_token');
    authToken = null;
    authModal.classList.add('active');
});

// Fetch Real Data
async function fetchDashboardData() {
    try {
        const [profileRes, balanceRes, txRes, contactsRes] = await Promise.all([
            fetch(`${API_BASE}/auth/profile`, { headers: { 'Authorization': `Bearer ${authToken}` } }),
            fetch(`${API_BASE}/wallet/balance`, { headers: { 'Authorization': `Bearer ${authToken}` } }),
            fetch(`${API_BASE}/transactions`, { headers: { 'Authorization': `Bearer ${authToken}` } }),
            fetch(`${API_BASE}/transactions/contacts`, { headers: { 'Authorization': `Bearer ${authToken}` } })
        ]);

        const profileData = await profileRes.json();
        const balanceData = await balanceRes.json();
        const txData = await txRes.json();
        const contactsData = await contactsRes.json();

        if (profileData.success) {
            currentUser = profileData.data.user;
            document.querySelector('.user-name').innerText = `${currentUser.firstName} ${currentUser.lastName}`;
            document.querySelector('.avatar').src = `https://ui-avatars.com/api/?name=${currentUser.firstName}+${currentUser.lastName}&background=0D8ABC&color=fff&rounded=true`;
        }

        if (balanceData.success) {
            currentWallet = balanceData.data.wallet;
            const balanceInt = Math.floor(currentWallet.balance);
            const balanceDec = (currentWallet.balance % 1).toFixed(2).substring(2);
            document.querySelector('.card-balance h2').innerHTML = `$${balanceInt}.<span>${balanceDec}</span>`;
        }

        if (contactsData.success) {
            renderContacts(contactsData.data.contacts);
        }

        if (txData.success) {
            renderTransactions(txData.data.transactions);
        }
    } catch (err) {
        console.error('Error fetching dashboard data:', err);
    }
}

// Render Contacts
let selectedContact = null;
function renderContacts(contactsList) {
    recentContactsEl.innerHTML = '';
    
    // Add default "Add New" button
    const defaultContacts = [{
        id: 'new',
        name: 'Add New',
        phone: '',
        upiId: '',
        initials: '+'
    }];
    
    const allContacts = [...contactsList, ...defaultContacts];

    allContacts.forEach(contact => {
        const namePart = contact.name || 'Unknown';
        const imgUrl = contact.id === 'new' 
            ? 'https://ui-avatars.com/api/?name=%2B&background=f1f5f9&color=64748b' 
            : `https://ui-avatars.com/api/?name=${namePart.replace(' ', '+')}&background=random`;

        const img = document.createElement('img');
        img.src = imgUrl;
        img.alt = namePart;
        img.title = namePart;
        
        if (!selectedContact && contact.id !== 'new') {
            selectedContact = contact;
        }

        img.className = `contact-avatar ${selectedContact && contact.id === selectedContact.id ? 'selected' : ''}`;
        
        img.addEventListener('click', () => {
            if(contact.id === 'new') {
                const phone = prompt('Enter phone number to transfer to:');
                if(phone) {
                    selectedContact = { id: 'manual', phone, name: phone };
                    renderContacts(allContacts);
                }
            } else {
                selectedContact = contact;
                renderContacts(allContacts);
            }
        });
        
        recentContactsEl.appendChild(img);
    });
}

// Render Transactions
function renderTransactions(txList) {
    transactionListEl.innerHTML = '';
    
    if(!txList || txList.length === 0) {
        transactionListEl.innerHTML = '<p style="text-align:center; color: var(--text-muted); padding: 20px;">No transactions found.</p>';
        return;
    }

    txList.forEach(tx => {
        // Determine type from my perspective
        let isIncome = false;
        let txTitle = tx.description || 'Transaction';
        let txIcon = 'ri-exchange-dollar-line';
        let iconClass = 'transfer';
        
        if (tx.type === 'deposit') {
            isIncome = true;
            txTitle = 'Deposit';
            txIcon = 'ri-briefcase-4-fill';
            iconClass = 'income';
        } else if (tx.type === 'withdraw') {
            isIncome = false;
            txTitle = 'Withdrawal';
            txIcon = 'ri-bank-card-line';
            iconClass = 'expense';
        } else if (tx.type === 'transfer') {
            if (tx.receiverId === currentUser?._id) {
                isIncome = true;
                txTitle = `Received from ${tx.senderPhone || 'User'}`;
                txIcon = 'ri-arrow-left-down-line';
                iconClass = 'income';
            } else {
                isIncome = false;
                txTitle = `Sent to ${tx.receiverPhone || 'User'}`;
                txIcon = 'ri-arrow-right-up-line';
                iconClass = 'expense';
            }
        }

        const amountClass = isIncome ? 'positive' : 'negative';
        const formattedAmount = `${isIncome ? '+' : '-'}$${Math.abs(tx.amount).toFixed(2)}`;
        const dateStr = new Date(tx.createdAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute:'2-digit' });

        const html = `
            <div class="tx-item">
                <div class="tx-info">
                    <div class="tx-icon ${iconClass}">
                        <i class="${txIcon}"></i>
                    </div>
                    <div class="tx-details">
                        <h4>${txTitle}</h4>
                        <p>${dateStr}</p>
                    </div>
                </div>
                <div class="tx-amount ${amountClass}">
                    ${formattedAmount}
                </div>
            </div>
        `;
        transactionListEl.insertAdjacentHTML('beforeend', html);
    });
}

// Handle Transfer Form
transferForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const amountInput = document.getElementById('transferAmount').value;
    
    if(!amountInput || amountInput <= 0) return;
    
    if(!selectedContact) {
        alert("Please select or add a contact to transfer to.");
        return;
    }

    // Default PIN for this demo is 1234 since we set it on register
    // Or prompt for it!
    const pin = prompt('Enter your 4-digit PIN (default 1234):', '1234');
    if(!pin) return;

    try {
        const payload = {
            amount: parseFloat(amountInput),
            pin: pin,
            notes: 'Transfer from Web UI'
        };
        
        if (selectedContact.upiId) {
            payload.upiId = selectedContact.upiId;
        } else {
            payload.phoneNumber = selectedContact.phone;
        }

        const endpoint = selectedContact.upiId ? '/transfer/upi' : '/transfer/phone';

        const res = await fetch(`${API_BASE}${endpoint}`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify(payload)
        });
        
        const data = await res.json();
        
        if (data.success) {
            // Show modal
            document.getElementById('modalAmount').innerText = `$${parseFloat(amountInput).toFixed(2)}`;
            document.getElementById('modalRecipient').innerText = selectedContact.name || selectedContact.phone;
            transferModal.classList.add('active');
            
            // Refresh data
            fetchDashboardData();
            
            // Reset form
            transferForm.reset();
        } else {
            alert(data.message || 'Transfer failed');
        }
    } catch (err) {
        console.error(err);
        alert('An error occurred during transfer');
    }
});

// Top Up Flow (Adding money to wallet to play around)
document.querySelector('.icon-wrapper.purple').parentElement.addEventListener('click', async (e) => {
    e.preventDefault();
    const amount = prompt('How much would you like to top up?');
    if(amount && parseFloat(amount) > 0) {
        try {
            const res = await fetch(`${API_BASE}/wallet/add-money`, {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${authToken}`
                },
                body: JSON.stringify({ amount: parseFloat(amount), source: 'bank_account', referenceId: 'DEMO' + Date.now() })
            });
            const data = await res.json();
            if(data.success) {
                alert('Wallet topped up successfully!');
                fetchDashboardData();
            } else {
                alert(data.message || 'Top up failed');
            }
        } catch (err) {
            console.error(err);
            alert('Error topping up wallet');
        }
    }
});

// Modal Actions
function closeModal() {
    transferModal.classList.remove('active');
}

window.openTransferModal = () => {
    document.getElementById('transferAmount').focus();
};
window.closeModal = closeModal;
