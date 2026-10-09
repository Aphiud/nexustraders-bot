import React from 'react';
import { getUser, login, logout, type User } from '@netlify/identity';
import Button from '@/components/shared_ui/button';
import {
    classifyBulkPurchaseResponse,
    type BulkPurchaseAccount,
    type BulkPurchaseEnvironment,
    type BulkPurchaseTransaction,
    validateBulkPurchaseInput,
} from '@/utils/bulk-purchase';
import './bulk-purchase.scss';

const ACCOUNT_URL = '/.netlify/functions/bulk-purchase-accounts';
const PURCHASE_URL = '/.netlify/functions/bulk-purchase';

type BulkPurchaseProps = { isBotRunning?: boolean; onStopBot?: () => void };

export default function BulkPurchase({ isBotRunning = false, onStopBot }: BulkPurchaseProps) {
    const [open, setOpen] = React.useState(false);
    const [user, setUser] = React.useState<User | null>(null);
    const [environment, setEnvironment] = React.useState<BulkPurchaseEnvironment>('demo');
    const [accounts, setAccounts] = React.useState<BulkPurchaseAccount[]>([]);
    const [selectedIds, setSelectedIds] = React.useState<string[]>([]);
    const [parametersText, setParametersText] = React.useState('');
    const [transactions, setTransactions] = React.useState<BulkPurchaseTransaction[] | null>(null);
    const [error, setError] = React.useState('');
    const [busy, setBusy] = React.useState(false);
    const busyRef = React.useRef(false);
    const mountedRef = React.useRef(true);

    React.useEffect(() => {
        mountedRef.current = true;
        return () => { mountedRef.current = false; };
    }, []);

    const loadAccounts = React.useCallback(async () => {
        try {
            const response = await fetch(ACCOUNT_URL, { credentials: 'same-origin', cache: 'no-store' });
            const payload = await response.json();
            if (!response.ok) throw new Error(payload?.error || 'Unable to load configured accounts.');
            if (!Array.isArray(payload?.accounts)) throw new Error('The server returned an invalid account list.');
            if (!mountedRef.current) return;
            setAccounts(payload.accounts);
            setSelectedIds([]);
        } catch (caught) {
            if (mountedRef.current) setError(caught instanceof Error ? caught.message : 'Unable to load accounts.');
        }
    }, []);

    React.useEffect(() => {
        if (!open) return;
        let active = true;
        void getUser().then(current => {
            if (!active || !mountedRef.current) return;
            setUser(current);
            if (current?.roles?.includes('bulk-purchase')) void loadAccounts();
        }).catch(() => {
            if (active && mountedRef.current) setError('Unable to check your Bulk Purchase access.');
        });
        return () => { active = false; };
    }, [open, loadAccounts]);

    const accountsForEnvironment = accounts.filter(account => account.account_type === environment);
    const validationError = validateBulkPurchaseInput({ accountIds: selectedIds, contractParametersText: parametersText });

    const handleLogin = async (event: React.FormEvent) => {
        event.preventDefault();
        setError('');
        setBusy(true);
        const form = event.currentTarget as HTMLFormElement;
        const values = new FormData(form);
        const email = String(values.get('email') || '').trim();
        const password = String(values.get('password') || '');
        try {
            const authenticated = await login(email.trim(), password);
            setUser(authenticated);
            form.reset();
            if (authenticated.roles?.includes('bulk-purchase')) await loadAccounts();
        } catch {
            setError('Sign in failed. Check your Netlify Identity credentials and try again.');
        } finally {
            form.reset();
            if (mountedRef.current) setBusy(false);
        }
    };

    const handlePurchase = async (event: React.FormEvent) => {
        event.preventDefault();
        if (busyRef.current || validationError) return;
        if (environment === 'real' && !window.confirm(`Confirm real-account purchase for ${selectedIds.length} account(s)? Deriv will submit one purchase per selected account.`)) return;
        busyRef.current = true;
        setBusy(true);
        setError('');
        setTransactions(null);
        try {
            const contractParameters = JSON.parse(parametersText) as Record<string, unknown>;
            const response = await fetch(PURCHASE_URL, {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ account_type: environment, account_ids: selectedIds, contract_parameters: contractParameters }),
            });
            const payload: unknown = await response.json().catch(() => null);
            if (!response.ok) {
                if (response.status === 401 && mountedRef.current) setUser(null);
                const message = payload && typeof payload === 'object' && 'error' in payload && typeof payload.error === 'string'
                    ? payload.error
                    : 'Bulk Purchase could not be completed. Check account activity before submitting again.';
                throw new Error(message);
            }
            const result = classifyBulkPurchaseResponse(payload);
            if (!result) throw new Error('Deriv returned an unexpected response. Check account activity before submitting again.');
            if (mountedRef.current) setTransactions(result.data.transactions);
        } catch (caught) {
            if (mountedRef.current) setError(caught instanceof Error ? caught.message : 'Network error. Check account activity before submitting again.');
        } finally {
            busyRef.current = false;
            if (mountedRef.current) setBusy(false);
        }
    };

    const toggleAccount = (id: string) => {
        setSelectedIds(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id]);
    };

    const handleLogout = async () => {
        setBusy(true);
        try {
            await logout();
            setUser(null);
            setAccounts([]);
            setSelectedIds([]);
        } catch {
            setError('Sign out could not be completed.');
        } finally {
            if (mountedRef.current) setBusy(false);
        }
    };

    const successful = transactions?.filter(item => !item.error) ?? [];
    const failed = transactions?.filter(item => item.error) ?? [];

    return (
        <>
            <Button type='button' secondary small onClick={() => { setOpen(true); setError(''); }}>
                Bulk Purchase
            </Button>
            {open && (
                <div className='bulk-purchase__backdrop' role='presentation' onMouseDown={event => {
                    if (event.target === event.currentTarget && !busy) setOpen(false);
                }}>
                    <section className='bulk-purchase' role='dialog' aria-modal='true' aria-labelledby='bulk-purchase-title'>
                        <header className='bulk-purchase__header'>
                            <h2 id='bulk-purchase-title'>Bulk Purchase</h2>
                            <button type='button' className='bulk-purchase__close' onClick={() => setOpen(false)} disabled={busy} aria-label='Close'>×</button>
                        </header>
                        <p className='bulk-purchase__hint'>Buy the same contract for selected configured accounts. The request does not use or open a bot WebSocket.</p>
                        {isBotRunning && <div className='bulk-purchase__stop-row'><span>Your bot is running.</span><Button type='button' secondary onClick={onStopBot}>Stop bot</Button></div>}
                        {error && <div className='bulk-purchase__error' role='alert'>{error}</div>}
                        {!user ? (
                            <form className='bulk-purchase__form' onSubmit={handleLogin}>
                                <p>Sign in with an authorized Netlify Identity account to continue.</p>
                <label>Email<input name='email' type='email' autoComplete='username' required /></label>
                <label>Password<input name='password' type='password' autoComplete='current-password' required /></label>
                                <Button type='submit' primary is_disabled={busy} is_loading={busy}>Sign in</Button>
                            </form>
                        ) : !user.roles?.includes('bulk-purchase') ? (
                            <div className='bulk-purchase__form'>
                                <p>This account does not have the <code>bulk-purchase</code> role.</p>
                                <Button type='button' secondary onClick={() => void handleLogout()}>Sign out</Button>
                            </div>
                        ) : (
                            <form className='bulk-purchase__form' onSubmit={handlePurchase}>
                                <div className='bulk-purchase__identity'>Signed in as {user.email || 'authorized user'} <button type='button' onClick={() => void handleLogout()} disabled={busy}>Sign out</button></div>
                                <fieldset>
                                    <legend>Account environment</legend>
                                    <label className='bulk-purchase__radio'><input type='radio' name='environment' value='demo' checked={environment === 'demo'} onChange={() => { setEnvironment('demo'); setSelectedIds([]); setTransactions(null); }} />Demo</label>
                                    <label className='bulk-purchase__radio'><input type='radio' name='environment' value='real' checked={environment === 'real'} onChange={() => { setEnvironment('real'); setSelectedIds([]); setTransactions(null); }} />Real</label>
                                </fieldset>
                                <fieldset>
                                    <legend>Accounts ({selectedIds.length}/100)</legend>
                                    {accountsForEnvironment.length === 0 ? <p>No configured {environment} accounts are available.</p> : accountsForEnvironment.map(account => (
                                        <label className='bulk-purchase__account' key={account.account_id}>
                                            <input type='checkbox' checked={selectedIds.includes(account.account_id)} onChange={() => toggleAccount(account.account_id)} disabled={!selectedIds.includes(account.account_id) && selectedIds.length >= 100} />
                                            <span>{account.label}</span><small>{account.account_id}</small>
                                        </label>
                                    ))}
                                </fieldset>
                                <label>Contract parameters (JSON object)
                                    <textarea rows={8} spellCheck={false} value={parametersText} onChange={event => setParametersText(event.target.value)} placeholder={'Paste the options contract parameters supported by Deriv, for example fields such as contract_type, symbol, amount and duration.'} />
                                </label>
                                <p className='bulk-purchase__hint'>Deriv applies this one parameter object to each selected account. The server validates the account list and amount; Deriv validates the contract definition.</p>
                                {validationError && <p className='bulk-purchase__validation' role='status'>{validationError}</p>}
                                <Button type='submit' primary is_disabled={busy || !!validationError || accountsForEnvironment.length === 0} is_loading={busy}>
                                    {environment === 'real' ? 'Confirm real purchase' : 'Purchase on demo accounts'}
                                </Button>
                                {transactions && <div className='bulk-purchase__results' aria-live='polite'>
                                    <h3>Results</h3>
                                    {successful.length > 0 && <section><h4>Successful ({successful.length})</h4><ul>{successful.map(item => <li key={`${item.account_id}-${item.transaction_id}`}><strong>{item.account_id}</strong> — Contract {item.contract_id}, transaction {item.transaction_id}, price {item.buy_price}</li>)}</ul></section>}
                                    {failed.length > 0 && <section><h4>Failed ({failed.length})</h4><ul>{failed.map(item => <li key={item.account_id}><strong>{item.account_id}</strong> — {item.error?.message}</li>)}</ul></section>}
                                    {transactions.length === 0 && <p>Deriv returned no account results.</p>}
                                </div>}
                            </form>
                        )}
                    </section>
                </div>
            )}
        </>
    );
}
