import React from 'react';
import Button from '@/components/shared_ui/button';
import { getAuthInfo } from '@/external/deriv-core';
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

const readDerivAccessToken = () => {
    try {
        return getAuthInfo()?.access_token;
    } catch {
        return undefined;
    }
};

type BulkPurchaseProps = { activeLoginid?: string; isBotRunning?: boolean; onStopBot?: () => void };

export default function BulkPurchase({ activeLoginid = '', isBotRunning = false, onStopBot }: BulkPurchaseProps) {
    const [environment, setEnvironment] = React.useState<BulkPurchaseEnvironment>('demo');
    const [accounts, setAccounts] = React.useState<BulkPurchaseAccount[]>([]);
    const [selectedIds, setSelectedIds] = React.useState<string[]>([]);
    const [parametersText, setParametersText] = React.useState('');
    const [transactions, setTransactions] = React.useState<BulkPurchaseTransaction[] | null>(null);
    const [accountsLoading, setAccountsLoading] = React.useState(false);
    const [error, setError] = React.useState('');
    const [busy, setBusy] = React.useState(false);
    const busyRef = React.useRef(false);
    const mountedRef = React.useRef(true);
    const requestRef = React.useRef<AbortController | null>(null);

    React.useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
            requestRef.current?.abort();
            requestRef.current = null;
        };
    }, []);

    React.useEffect(() => {
        let active = true;
        setAccounts([]);
        setSelectedIds([]);
        setTransactions(null);
        setError('');
        setAccountsLoading(false);

        const accessToken = readDerivAccessToken();
        if (!activeLoginid || !accessToken) return () => { active = false; };

        setAccountsLoading(true);
        const controller = new AbortController();
        requestRef.current = controller;
        void fetch(ACCOUNT_URL, {
            credentials: 'same-origin',
            cache: 'no-store',
            headers: { Authorization: `Bearer ${accessToken}` },
            signal: controller.signal,
        }).then(async response => {
            const payload = await response.json().catch(() => null);
            if (!response.ok) {
                const message = payload && typeof payload === 'object' && 'error' in payload && typeof payload.error === 'string'
                    ? payload.error
                    : 'Unable to load accounts for your Deriv session.';
                throw new Error(message);
            }
            if (!Array.isArray(payload?.accounts)) throw new Error('The server returned an invalid account list.');
            if (active && mountedRef.current) setAccounts(payload.accounts);
        }).catch(caught => {
            if (active && mountedRef.current && !(caught instanceof Error && caught.name === 'AbortError')) {
                setError(caught instanceof Error ? caught.message : 'Unable to load your Deriv accounts.');
            }
        }).finally(() => {
            if (active && mountedRef.current) setAccountsLoading(false);
            if (requestRef.current === controller) requestRef.current = null;
        });

        return () => {
            active = false;
            controller.abort();
            if (requestRef.current === controller) requestRef.current = null;
        };
    }, [activeLoginid]);

    const accountsForEnvironment = accounts.filter(account => account.account_type === environment);
    const validationError = validateBulkPurchaseInput({ accountIds: selectedIds, contractParametersText: parametersText });

    const handlePurchase = async (event: React.FormEvent) => {
        event.preventDefault();
        if (busyRef.current || validationError) return;
        if (environment === 'real' && !window.confirm(`Confirm real-account purchase for ${selectedIds.length} account(s)? Deriv will submit one purchase per selected account.`)) return;

        const accessToken = readDerivAccessToken();
        if (!activeLoginid || !accessToken) {
            setError('Your Deriv session is not available. Sign in with Deriv using the site header, then return here.');
            return;
        }

        busyRef.current = true;
        setBusy(true);
        setError('');
        setTransactions(null);
        const controller = new AbortController();
        requestRef.current = controller;
        const timeout = window.setTimeout(() => controller.abort(), 25_000);
        try {
            const contractParameters = JSON.parse(parametersText) as Record<string, unknown>;
            const response = await fetch(PURCHASE_URL, {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'content-type': 'application/json', Authorization: `Bearer ${accessToken}` },
                body: JSON.stringify({ account_type: environment, account_ids: selectedIds, contract_parameters: contractParameters }),
                signal: controller.signal,
            });
            const payload: unknown = await response.json().catch(() => null);
            if (!response.ok) {
                const message = payload && typeof payload === 'object' && 'error' in payload && typeof payload.error === 'string'
                    ? payload.error
                    : 'Bulk Purchase could not be completed. Check account activity before submitting again.';
                throw new Error(message);
            }
            const result = classifyBulkPurchaseResponse(payload);
            if (!result) throw new Error('Deriv returned an unexpected response. Check account activity before submitting again.');
            if (mountedRef.current) setTransactions(result.data.transactions);
        } catch (caught) {
            if (mountedRef.current) {
                setError(caught instanceof Error && caught.name === 'AbortError'
                    ? 'The request timed out or was interrupted. Check account activity before submitting again.'
                    : caught instanceof Error ? caught.message : 'Network error. Check account activity before submitting again.');
            }
        } finally {
            window.clearTimeout(timeout);
            if (requestRef.current === controller) requestRef.current = null;
            busyRef.current = false;
            if (mountedRef.current) setBusy(false);
        }
    };

    const toggleAccount = (id: string) => {
        setSelectedIds(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id]);
    };
    const successful = transactions?.filter(item => !item.error) ?? [];
    const failed = transactions?.filter(item => item.error) ?? [];
    const isDerivAuthenticated = !!activeLoginid && !!readDerivAccessToken();

    return (
        <section className='bulk-purchase' aria-labelledby='bulk-purchase-title'>
            <header className='bulk-purchase__header'>
                <h2 id='bulk-purchase-title'>Bulk Purchase</h2>
            </header>
            <p className='bulk-purchase__hint'>Buy the same contract for selected accounts on your Deriv login. The request does not use or open a bot WebSocket.</p>
            {isBotRunning && <div className='bulk-purchase__stop-row'><span>Your bot is running.</span><Button type='button' secondary onClick={onStopBot}>Stop bot</Button></div>}
            {error && <div className='bulk-purchase__error' role='alert'>{error}</div>}
            {!isDerivAuthenticated ? (
                <div className='bulk-purchase__content'>
                    <p>Sign in with Deriv using the site header to load your accounts and use Bulk Purchase.</p>
                </div>
            ) : (
                <form className='bulk-purchase__content' onSubmit={handlePurchase}>
                    <fieldset>
                        <legend>Account environment</legend>
                        <label className='bulk-purchase__radio'><input type='radio' name='environment' value='demo' checked={environment === 'demo'} onChange={() => { setEnvironment('demo'); setSelectedIds([]); setTransactions(null); }} />Demo</label>
                        <label className='bulk-purchase__radio'><input type='radio' name='environment' value='real' checked={environment === 'real'} onChange={() => { setEnvironment('real'); setSelectedIds([]); setTransactions(null); }} />Real</label>
                    </fieldset>
                    <fieldset>
                        <legend>Authorized accounts ({selectedIds.length}/100)</legend>
                        {accountsLoading ? <p>Loading your authorized accounts…</p> : accountsForEnvironment.length === 0 ? <p>No configured {environment} accounts are available for your Deriv login.</p> : accountsForEnvironment.map(account => (
                            <label className='bulk-purchase__account' key={account.account_id}>
                                <input type='checkbox' checked={selectedIds.includes(account.account_id)} onChange={() => toggleAccount(account.account_id)} disabled={!selectedIds.includes(account.account_id) && selectedIds.length >= 100} />
                                <span>{account.label}</span><small>{account.account_id}</small>
                            </label>
                        ))}
                    </fieldset>
                    <label>Contract parameters (JSON object)
                        <textarea rows={8} spellCheck={false} value={parametersText} onChange={event => setParametersText(event.target.value)} placeholder={'Paste the options contract parameters supported by Deriv, for example fields such as contract_type, symbol, amount and duration.'} />
                    </label>
                    <p className='bulk-purchase__hint'>Deriv applies this one parameter object to each selected account. The server checks account ownership and amount; Deriv validates the contract definition.</p>
                    {validationError && <p className='bulk-purchase__validation' role='status'>{validationError}</p>}
                    <Button type='submit' primary is_disabled={busy || accountsLoading || !!validationError || accountsForEnvironment.length === 0} is_loading={busy}>
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
    );
}
