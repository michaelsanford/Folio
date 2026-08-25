import React, { useState } from "react";
import {
  Plus,
  CreditCard,
  Building2,
  PiggyBank,
  Edit2,
  Trash2,
} from "lucide-react";
import type { Account, AccountType } from "../../types";
import { api } from "../../services/api";

interface AccountsManagerViewProps {
  accounts: Account[];
  onAccountsModified: () => void;
}

export const AccountsManagerView: React.FC<AccountsManagerViewProps> = ({
  accounts,
  onAccountsModified,
}) => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<Account | null>(null);
  const [formData, setFormData] = useState<{
    name: string;
    type: AccountType;
    institution: string;
    account_number_mask: string;
    current_balance: number;
    credit_limit: number;
    interest_rate: number;
    loan_term_months: number;
    loan_original_principal: number;
    monthly_payment: number;
    escrow_payment: number;
  }>({
    name: "",
    type: "CHECKING",
    institution: "",
    account_number_mask: "",
    current_balance: 0.0,
    credit_limit: 0.0,
    interest_rate: 0.0,
    loan_term_months: 360,
    loan_original_principal: 0.0,
    monthly_payment: 0.0,
    escrow_payment: 0.0,
  });

  const handleOpenCreate = () => {
    setEditingAccount(null);
    setFormData({
      name: "",
      type: "CHECKING",
      institution: "",
      account_number_mask: "",
      current_balance: 0.0,
      credit_limit: 0.0,
      interest_rate: 0.0,
      loan_term_months: 360,
      loan_original_principal: 0.0,
      monthly_payment: 0.0,
      escrow_payment: 0.0,
    });
    setIsModalOpen(true);
  };

  const handleOpenEdit = (acc: Account) => {
    setEditingAccount(acc);
    setFormData({
      name: acc.name,
      type: acc.type,
      institution: acc.institution || "",
      account_number_mask: acc.account_number_mask || "",
      current_balance: acc.current_balance,
      credit_limit: acc.credit_limit || 0.0,
      interest_rate: acc.interest_rate || 0.0,
      loan_term_months: acc.loan_term_months || 360,
      loan_original_principal: acc.loan_original_principal || 0.0,
      monthly_payment: acc.monthly_payment || 0.0,
      escrow_payment: acc.escrow_payment || 0.0,
    });
    setIsModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const payload: Partial<Account> = {
        name: formData.name,
        type: formData.type,
        institution: formData.institution || undefined,
        account_number_mask: formData.account_number_mask || undefined,
        current_balance: Number(formData.current_balance),
        credit_limit: formData.type === "CREDIT_CARD" ? Number(formData.credit_limit) : undefined,
        interest_rate: Number(formData.interest_rate) || undefined,
        loan_term_months: Number(formData.loan_term_months) || undefined,
        loan_original_principal: Number(formData.loan_original_principal) || undefined,
        monthly_payment: Number(formData.monthly_payment) || undefined,
        escrow_payment: Number(formData.escrow_payment) || undefined,
      };

      if (editingAccount) {
        await api.updateAccount(editingAccount.id, payload);
      } else {
        await api.createAccount(payload);
      }

      setIsModalOpen(false);
      onAccountsModified();
    } catch (err: any) {
      alert(`Operation failed: ${err.message}`);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this account and all associated transactions?")) return;
    try {
      await api.deleteAccount(id);
      onAccountsModified();
    } catch (err: any) {
      alert(`Delete failed: ${err.message}`);
    }
  };

  const assetAccounts = accounts.filter((a) =>
    ["CHECKING", "SAVINGS", "INVESTMENT", "OTHER_ASSET"].includes(a.type)
  );

  const liabilityAccounts = accounts.filter((a) =>
    ["CREDIT_CARD", "MORTGAGE", "VEHICLE_LOAN", "OTHER_LIABILITY"].includes(a.type)
  );

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-6 rounded-2xl bg-slate-900/60 border border-slate-800/80 shadow-lg">
        <div>
          <h1 className="text-xl font-bold text-slate-100">Accounts & Portfolios</h1>
          <p className="text-xs text-slate-400 mt-1">
            Manage deposit accounts, credit cards, mortgages, and vehicle loans.
          </p>
        </div>

        <button
          onClick={handleOpenCreate}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-lg shadow-indigo-500/20"
        >
          <Plus className="w-4 h-4" /> Add Account
        </button>
      </div>

      {/* Asset Accounts Grid */}
      <div className="space-y-3">
        <h2 className="text-sm font-bold text-slate-300 uppercase tracking-wider">Asset Accounts</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {assetAccounts.map((acc) => (
            <div
              key={acc.id}
              className="p-5 rounded-2xl bg-slate-900/60 border border-slate-800/80 shadow-lg flex flex-col justify-between"
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 rounded-xl bg-emerald-500/10 text-emerald-400">
                    <PiggyBank className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-slate-100">{acc.name}</h3>
                    <p className="text-xs text-slate-400">
                      {acc.institution} {acc.account_number_mask ? `(${acc.account_number_mask})` : ""}
                    </p>
                  </div>
                </div>

                <div className="flex gap-1">
                  <button
                    onClick={() => handleOpenEdit(acc)}
                    className="p-1 text-slate-400 hover:text-indigo-400"
                  >
                    <Edit2 className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleDelete(acc.id)}
                    className="p-1 text-slate-400 hover:text-rose-400"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div className="mt-4 pt-4 border-t border-slate-800/80 flex items-center justify-between">
                <span className="text-xs text-slate-400">Current Balance</span>
                <span className="text-lg font-bold text-emerald-400 font-mono">
                  ${acc.current_balance.toLocaleString("en-US", { minimumFractionDigits: 2 })}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Liability Accounts Grid */}
      <div className="space-y-3">
        <h2 className="text-sm font-bold text-slate-300 uppercase tracking-wider">
          Liabilities & Loans
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {liabilityAccounts.map((acc) => (
            <div
              key={acc.id}
              className="p-5 rounded-2xl bg-slate-900/60 border border-slate-800/80 shadow-lg flex flex-col justify-between"
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 rounded-xl bg-violet-500/10 text-violet-400">
                    {acc.type === "CREDIT_CARD" ? (
                      <CreditCard className="w-5 h-5 text-amber-400" />
                    ) : (
                      <Building2 className="w-5 h-5" />
                    )}
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-slate-100">{acc.name}</h3>
                    <p className="text-xs text-slate-400">
                      {acc.institution} {acc.account_number_mask ? `(${acc.account_number_mask})` : ""}
                    </p>
                  </div>
                </div>

                <div className="flex gap-1">
                  <button
                    onClick={() => handleOpenEdit(acc)}
                    className="p-1 text-slate-400 hover:text-indigo-400"
                  >
                    <Edit2 className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleDelete(acc.id)}
                    className="p-1 text-slate-400 hover:text-rose-400"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div className="mt-4 pt-4 border-t border-slate-800/80 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-slate-400">Current Balance</span>
                  <span className="text-lg font-bold text-rose-400 font-mono">
                    ${acc.current_balance.toLocaleString("en-US", { minimumFractionDigits: 2 })}
                  </span>
                </div>
                {acc.interest_rate ? (
                  <div className="flex items-center justify-between text-xs text-slate-400">
                    <span>Interest Rate</span>
                    <span className="font-semibold text-amber-400">{acc.interest_rate}% APR</span>
                  </div>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Create / Edit Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in">
          <form
            onSubmit={handleSubmit}
            className="w-full max-w-md rounded-2xl bg-slate-900 border border-slate-800 shadow-2xl p-6 space-y-4 max-h-[90vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-base font-bold text-slate-100">
                {editingAccount ? "Edit Account" : "Add New Account"}
              </h3>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="text-slate-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-400 mb-1">Account Name</label>
                <input
                  type="text"
                  placeholder="e.g. Primary Checking or Chase Sapphire"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-200"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 mb-1">Account Type</label>
                  <select
                    value={formData.type}
                    onChange={(e) => setFormData({ ...formData, type: e.target.value as AccountType })}
                    className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-200"
                  >
                    <option value="CHECKING">Checking</option>
                    <option value="SAVINGS">Savings</option>
                    <option value="CREDIT_CARD">Credit Card</option>
                    <option value="MORTGAGE">Mortgage</option>
                    <option value="VEHICLE_LOAN">Vehicle Loan</option>
                    <option value="INVESTMENT">Investment</option>
                    <option value="OTHER_ASSET">Other Asset</option>
                    <option value="OTHER_LIABILITY">Other Liability</option>
                  </select>
                </div>

                <div>
                  <label className="block text-slate-400 mb-1">Institution</label>
                  <input
                    type="text"
                    placeholder="e.g. Chase, Wells Fargo"
                    value={formData.institution}
                    onChange={(e) => setFormData({ ...formData, institution: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-200"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 mb-1">Account Mask</label>
                  <input
                    type="text"
                    placeholder="*1234"
                    value={formData.account_number_mask}
                    onChange={(e) => setFormData({ ...formData, account_number_mask: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-200"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">Current Balance</label>
                  <input
                    type="number"
                    step="0.01"
                    value={formData.current_balance}
                    onChange={(e) => setFormData({ ...formData, current_balance: parseFloat(e.target.value) || 0 })}
                    className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-200 font-mono"
                  />
                </div>
              </div>

              {formData.type === "CREDIT_CARD" && (
                <div>
                  <label className="block text-slate-400 mb-1">Credit Limit</label>
                  <input
                    type="number"
                    step="100"
                    placeholder="10000"
                    value={formData.credit_limit}
                    onChange={(e) => setFormData({ ...formData, credit_limit: parseFloat(e.target.value) || 0 })}
                    className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-200 font-mono"
                  />
                </div>
              )}

              {["MORTGAGE", "VEHICLE_LOAN", "OTHER_LIABILITY"].includes(formData.type) && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-slate-400 mb-1">Interest Rate (APR %)</label>
                      <input
                        type="number"
                        step="0.01"
                        placeholder="6.5"
                        value={formData.interest_rate}
                        onChange={(e) => setFormData({ ...formData, interest_rate: parseFloat(e.target.value) || 0 })}
                        className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-200 font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-slate-400 mb-1">Loan Term (Months)</label>
                      <input
                        type="number"
                        placeholder="360"
                        value={formData.loan_term_months}
                        onChange={(e) => setFormData({ ...formData, loan_term_months: parseInt(e.target.value) || 360 })}
                        className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-200 font-mono"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-slate-400 mb-1">Orig. Principal</label>
                      <input
                        type="number"
                        step="1000"
                        placeholder="350000"
                        value={formData.loan_original_principal}
                        onChange={(e) => setFormData({ ...formData, loan_original_principal: parseFloat(e.target.value) || 0 })}
                        className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-200 font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-slate-400 mb-1">Monthly Payment (P&I)</label>
                      <input
                        type="number"
                        step="10"
                        placeholder="2200"
                        value={formData.monthly_payment}
                        onChange={(e) => setFormData({ ...formData, monthly_payment: parseFloat(e.target.value) || 0 })}
                        className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-200 font-mono"
                      />
                    </div>
                  </div>

                  {formData.type === "MORTGAGE" && (
                    <div>
                      <label className="block text-slate-400 mb-1">Escrow (Taxes & Ins.)</label>
                      <input
                        type="number"
                        step="10"
                        placeholder="450"
                        value={formData.escrow_payment}
                        onChange={(e) => setFormData({ ...formData, escrow_payment: parseFloat(e.target.value) || 0 })}
                        className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-200 font-mono"
                      />
                    </div>
                  )}
                </>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="px-4 py-2 rounded-lg border border-slate-700 text-slate-300 text-xs"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold"
              >
                {editingAccount ? "Update Account" : "Create Account"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
