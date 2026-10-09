export type BulkPurchaseEnvironment = 'demo' | 'real';

export interface BulkPurchaseAccount {
    account_id: string;
    label: string;
    account_type: BulkPurchaseEnvironment;
}

export interface BulkPurchaseTransaction {
    account_id: string;
    contract_id?: number;
    buy_price?: number;
    transaction_id?: number;
    error?: { code: string; message: string };
}

export interface BulkPurchaseResponse {
    data: { transactions: BulkPurchaseTransaction[] };
    meta: { endpoint: string; method: 'POST'; timing: number };
}

export const MAX_BULK_ACCOUNTS = 100;

export function validateBulkPurchaseInput(input: {
    accountIds: string[];
    contractParametersText: string;
}): string | null {
    if (!Array.isArray(input.accountIds) || input.accountIds.length === 0) {
        return 'Select at least one account.';
    }
    if (input.accountIds.length > MAX_BULK_ACCOUNTS) {
        return `Select no more than ${MAX_BULK_ACCOUNTS} accounts.`;
    }
    if (new Set(input.accountIds).size !== input.accountIds.length) {
        return 'An account can only be selected once.';
    }

    let parameters: unknown;
    try {
        parameters = JSON.parse(input.contractParametersText);
    } catch {
        return 'Contract parameters must be valid JSON.';
    }
    if (!parameters || typeof parameters !== 'object' || Array.isArray(parameters)) {
        return 'Contract parameters must be a JSON object.';
    }
    if (Object.keys(parameters).length === 0) {
        return 'Enter the contract parameters to purchase.';
    }
    if ('amount' in parameters) {
        const amount = (parameters as Record<string, unknown>).amount;
        if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
            return 'Amount must be a positive number.';
        }
    }
    return null;
}

export function classifyBulkPurchaseResponse(value: unknown): BulkPurchaseResponse | null {
    if (!value || typeof value !== 'object') return null;
    const data = (value as { data?: unknown }).data;
    if (!data || typeof data !== 'object') return null;
    const transactions = (data as { transactions?: unknown }).transactions;
    if (!Array.isArray(transactions)) return null;
    const meta = (value as { meta?: unknown }).meta;
    if (!meta || typeof meta !== 'object') return null;
    const metadata = meta as Record<string, unknown>;
    if (typeof metadata.endpoint !== 'string' || metadata.method !== 'POST' || typeof metadata.timing !== 'number') return null;
    const valid = transactions.every((transaction: unknown) => {
        if (!transaction || typeof transaction !== 'object') return false;
        const result = transaction as Record<string, unknown>;
        if (typeof result.account_id !== 'string') return false;
        if (result.error !== undefined) {
            const error = result.error as Record<string, unknown> | null;
            return !!error && typeof error.code === 'string' && typeof error.message === 'string';
        }
        return (
            Number.isInteger(result.contract_id) &&
            typeof result.buy_price === 'number' &&
            Number.isInteger(result.transaction_id)
        );
    });
    return valid ? (value as BulkPurchaseResponse) : null;
}
