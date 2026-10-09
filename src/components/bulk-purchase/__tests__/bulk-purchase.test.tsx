import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { getAuthInfo } from '@/external/deriv-core';
import BulkPurchase from '../bulk-purchase';

jest.mock('@/external/deriv-core', () => ({ getAuthInfo: jest.fn() }));
jest.mock('@/components/shared_ui/button', () => ({
    __esModule: true,
    default: ({ children, is_disabled, is_loading, secondary, small, primary, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { children?: React.ReactNode; is_disabled?: boolean; is_loading?: boolean; secondary?: boolean; small?: boolean; primary?: boolean }) => (
        <button {...props} disabled={is_disabled || is_loading}>{children}</button>
    ),
}));

const accountList = { accounts: [
    { account_id: 'VRTC1', label: 'Demo one', account_type: 'demo' },
    { account_id: 'CR1', label: 'Real one', account_type: 'real' },
] };
const successfulResponse = { data: { transactions: [{ account_id: 'VRTC1', contract_id: 12, buy_price: 1, transaction_id: 21 }] }, meta: { endpoint: '/contracts/bulk-purchase/demo', method: 'POST', timing: 1 } };
const mockResponse = (payload: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => payload });
const renderAuthenticated = (props: React.ComponentProps<typeof BulkPurchase> = {}) => render(<BulkPurchase activeLoginid='VRTC1' {...props} />);

describe('Bulk Purchase tab', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (getAuthInfo as jest.Mock).mockReturnValue({ access_token: 'existing-deriv-oauth-token', expires_at: Date.now() / 1000 + 3600 });
        global.fetch = jest.fn().mockResolvedValue(mockResponse(accountList)) as jest.Mock;
        window.confirm = jest.fn().mockReturnValue(true);
    });

    it('reuses the existing Deriv login without prompting for another sign-in', async () => {
        renderAuthenticated();
        await screen.findByLabelText(/Demo one/);
        expect(screen.queryByLabelText('Email')).not.toBeInTheDocument();
        expect(screen.queryByLabelText('Password')).not.toBeInTheDocument();
        expect((global.fetch as jest.Mock).mock.calls[0][1].headers.Authorization).toBe('Bearer existing-deriv-oauth-token');
    });

    it('loads configured accounts and submits one demo bulk request', async () => {
        (global.fetch as jest.Mock).mockImplementation((url: string) => Promise.resolve(
            mockResponse(url === '/.netlify/functions/bulk-purchase-accounts' ? accountList : successfulResponse)
        ));
        renderAuthenticated();
        await screen.findByLabelText(/Demo one/);
        fireEvent.click(screen.getByLabelText(/Demo one/));
        fireEvent.change(screen.getByLabelText(/Contract parameters/), { target: { value: '{"symbol":"R_10","amount":1}' } });
        fireEvent.click(screen.getByRole('button', { name: 'Purchase on demo accounts' }));
        await screen.findByText(/Successful \(1\)/);
        const purchaseCall = (global.fetch as jest.Mock).mock.calls.find(([url]) => url === '/.netlify/functions/bulk-purchase');
        expect(purchaseCall).toBeDefined();
        expect(JSON.parse(purchaseCall[1].body)).toEqual({ account_type: 'demo', account_ids: ['VRTC1'], contract_parameters: { symbol: 'R_10', amount: 1 } });
        expect(purchaseCall[1].headers.Authorization).toBe('Bearer existing-deriv-oauth-token');
        expect(purchaseCall[1].body).not.toContain('existing-deriv-oauth-token');
        expect(window.confirm).not.toHaveBeenCalled();
    });

    it('requires real-account confirmation and blocks rapid duplicate submission', async () => {
        let resolvePurchase!: (response: Response) => void;
        (global.fetch as jest.Mock).mockImplementation((url: string) => {
            if (url === '/.netlify/functions/bulk-purchase-accounts') return Promise.resolve(mockResponse(accountList));
            return new Promise(resolve => { resolvePurchase = resolve; });
        });
        renderAuthenticated();
        fireEvent.click(await screen.findByLabelText('Real'));
        await screen.findByLabelText(/Real one/);
        fireEvent.click(screen.getByLabelText(/Real one/));
        fireEvent.change(screen.getByLabelText(/Contract parameters/), { target: { value: '{"symbol":"R_10","amount":1}' } });
        const submit = screen.getByRole('button', { name: 'Confirm real purchase' });
        fireEvent.click(submit);
        fireEvent.click(submit);
        expect(window.confirm).toHaveBeenCalledTimes(1);
        await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));
        expect((global.fetch as jest.Mock).mock.calls[1][0]).toBe('/.netlify/functions/bulk-purchase');
        await act(async () => resolvePurchase(mockResponse(successfulResponse) as Response));
    });

    it('handles unmount during a pending purchase without updating cleared component state', async () => {
        let resolvePurchase!: (response: Response) => void;
        (global.fetch as jest.Mock).mockImplementation((url: string) => url === '/.netlify/functions/bulk-purchase-accounts'
            ? Promise.resolve(mockResponse(accountList))
            : new Promise(resolve => { resolvePurchase = resolve; }));
        const view = renderAuthenticated();
        await screen.findByLabelText(/Demo one/);
        fireEvent.click(screen.getByLabelText(/Demo one/));
        fireEvent.change(screen.getByLabelText(/Contract parameters/), { target: { value: '{"symbol":"R_10"}' } });
        fireEvent.click(screen.getByRole('button', { name: 'Purchase on demo accounts' }));
        await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));
        view.unmount();
        await act(async () => resolvePurchase(mockResponse(successfulResponse) as Response));
    });

    it('keeps the existing bot stop action available and independent during a bulk request', async () => {
        let resolvePurchase!: (response: Response) => void;
        const stopBot = jest.fn();
        (global.fetch as jest.Mock).mockImplementation((url: string) => url === '/.netlify/functions/bulk-purchase-accounts'
            ? Promise.resolve(mockResponse(accountList))
            : new Promise(resolve => { resolvePurchase = resolve; }));
        renderAuthenticated({ isBotRunning: true, onStopBot: stopBot });
        await screen.findByLabelText(/Demo one/);
        fireEvent.click(screen.getByLabelText(/Demo one/));
        fireEvent.change(screen.getByLabelText(/Contract parameters/), { target: { value: '{"symbol":"R_10"}' } });
        fireEvent.click(screen.getByRole('button', { name: 'Purchase on demo accounts' }));
        await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));
        fireEvent.click(screen.getByRole('button', { name: 'Stop bot' }));
        expect(stopBot).toHaveBeenCalledTimes(1);
        expect(global.fetch).toHaveBeenCalledTimes(2);
        await act(async () => resolvePurchase(mockResponse(successfulResponse) as Response));
        expect(await screen.findByText(/Successful \(1\)/)).toBeInTheDocument();
    });

    it('asks the user to sign in with the site header if the Deriv session is absent', () => {
        (getAuthInfo as jest.Mock).mockReturnValue(null);
        render(<BulkPurchase />);
        expect(screen.getByText(/Sign in with Deriv using the site header/)).toBeInTheDocument();
        expect(global.fetch).not.toHaveBeenCalled();
    });
});
