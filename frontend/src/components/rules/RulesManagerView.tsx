import React, { useState, useEffect } from "react";
import {
  Plus,
  Trash2,
  CheckCircle2,
  Sparkles,
  Play,
} from "lucide-react";
import type { CategorizationRule, Category, RulePatternType } from "../../types";
import { api } from "../../services/api";

interface RulesManagerViewProps {
  categories: Category[];
}

export const RulesManagerView: React.FC<RulesManagerViewProps> = ({ categories }) => {
  const [rules, setRules] = useState<CategorizationRule[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newRule, setNewRule] = useState<{
    category_id: string;
    pattern: string;
    pattern_type: RulePatternType;
    priority: number;
    normalized_payee_override: string;
  }>({
    category_id: categories[0]?.id || "",
    pattern: "",
    pattern_type: "CONTAINS",
    priority: 10,
    normalized_payee_override: "",
  });

  // Rule Matcher Sandbox
  const [testPayee, setTestPayee] = useState("");
  const [testAmount, setTestAmount] = useState(-25.5);
  const [testResult, setTestResult] = useState<{
    matched: boolean;
    suggested_category_id?: string;
    suggested_payee?: string;
  } | null>(null);

  const loadRules = async () => {
    setIsLoading(true);
    try {
      const data = await api.getRules();
      setRules(data);
    } catch (err: any) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadRules();
  }, []);

  const handleCreateRule = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.createRule(newRule);
      setIsModalOpen(false);
      setNewRule({
        category_id: categories[0]?.id || "",
        pattern: "",
        pattern_type: "CONTAINS",
        priority: 10,
        normalized_payee_override: "",
      });
      loadRules();
    } catch (err: any) {
      alert(`Create rule failed: ${err.message}`);
    }
  };

  const handleDeleteRule = async (id: string) => {
    if (!confirm("Are you sure you want to delete this rule?")) return;
    try {
      await api.deleteRule(id);
      loadRules();
    } catch (err: any) {
      alert(`Delete failed: ${err.message}`);
    }
  };

  const handleTestMatch = async () => {
    if (!testPayee) return;
    try {
      const res = await api.testRule({
        raw_payee: testPayee,
        amount: Number(testAmount),
      });
      setTestResult(res);
    } catch (err: any) {
      alert(`Test error: ${err.message}`);
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4 p-4 sm:p-6 rounded-2xl bg-slate-900/60 border border-slate-800/80 shadow-lg">
        <div>
          <h1 className="text-lg sm:text-xl font-bold text-slate-100">Auto-Categorization Rules</h1>
          <p className="text-xs text-slate-400 mt-1">
            Deterministic matching rules executed during statement ingestion and batch imports.
          </p>
        </div>

        <button
          onClick={() => setIsModalOpen(true)}
          className="flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-lg shadow-indigo-500/20 w-full sm:w-auto"
        >
          <Plus className="w-4 h-4" /> Create New Rule
        </button>
      </div>

      {/* Live Matcher Sandbox */}
      <div className="p-4 sm:p-6 rounded-2xl bg-slate-900/60 border border-slate-800/80 shadow-xl space-y-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-200">
          <Sparkles className="w-4 h-4 text-amber-400" />
          <span>Interactive Rule Testing Sandbox</span>
        </div>
        <p className="text-xs text-slate-400">
          Type a raw bank statement string below to test if your active rules match and what category/payee will be assigned.
        </p>

        <div className="flex flex-col sm:flex-row flex-wrap items-stretch sm:items-center gap-2.5">
          <input
            type="text"
            placeholder="e.g. SQ *BLUE BOTTLE COFFEE #12"
            value={testPayee}
            onChange={(e) => setTestPayee(e.target.value)}
            className="flex-1 w-full sm:w-auto sm:min-w-[220px] px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-xs text-slate-200"
          />
          <div className="flex items-center gap-2">
            <input
              type="number"
              step="0.01"
              placeholder="Amount"
              value={testAmount}
              onChange={(e) => setTestAmount(parseFloat(e.target.value) || 0)}
              className="w-24 sm:w-28 px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-xs text-slate-200 font-mono"
            />
            <button
              onClick={handleTestMatch}
              className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-2 bg-indigo-600/20 border border-indigo-500/40 text-indigo-300 hover:bg-indigo-600/30 rounded-xl text-xs font-semibold"
            >
              <Play className="w-3.5 h-3.5" /> Test Match
            </button>
          </div>
        </div>

        {testResult && (
          <div
            className={`p-4 rounded-xl text-xs border ${
              testResult.matched
                ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300"
                : "bg-slate-800/40 border-slate-700/40 text-slate-400"
            }`}
          >
            {testResult.matched ? (
              <div className="flex items-center gap-3">
                <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
                <div>
                  <div className="font-bold">Match Found!</div>
                  <div className="text-[11px] mt-0.5">
                    Category:{" "}
                    <b>
                      {categories.find((c) => c.id === testResult.suggested_category_id)?.name ||
                        "Unknown"}
                    </b>{" "}
                    • Clean Payee: <b>{testResult.suggested_payee || testPayee}</b>
                  </div>
                </div>
              </div>
            ) : (
              <div>No rule matched this description and amount. It will fall back to ML/heuristic.</div>
            )}
          </div>
        )}
      </div>

      {/* Rules Container */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/60 overflow-hidden shadow-xl">
        {/* Mobile Rules Feed (< md) */}
        <div className="block md:hidden divide-y divide-slate-800/60 font-medium">
          {isLoading ? (
            <div className="p-8 text-center text-slate-400 text-xs">Loading rules...</div>
          ) : rules.length === 0 ? (
            <div className="p-8 text-center text-slate-500 text-xs">No categorization rules created yet.</div>
          ) : (
            rules.map((rule) => {
              const cat = categories.find((c) => c.id === rule.category_id);
              return (
                <div key={rule.id} className="p-3.5 space-y-2 hover:bg-slate-800/30">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[10px] text-slate-400">#{rule.priority}</span>
                      <span className="px-2 py-0.5 rounded-full text-[9px] font-mono font-semibold bg-slate-800 text-slate-300">
                        {rule.pattern_type}
                      </span>
                    </div>
                    <button
                      onClick={() => handleDeleteRule(rule.id)}
                      className="p-1 text-slate-400 hover:text-rose-400"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <div className="font-mono text-xs text-indigo-300 font-bold break-all">
                    {rule.pattern}
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs pt-1 border-t border-slate-800/40">
                    <div className="flex items-center gap-1.5">
                      <span
                        className="w-2 h-2 rounded-full"
                        style={{ backgroundColor: cat?.color || "#6366f1" }}
                      ></span>
                      <span className="text-slate-200 text-[11px]">{cat?.name || "Unknown"}</span>
                    </div>
                    {rule.normalized_payee_override && (
                      <span className="text-[11px] text-slate-400">
                        $\to$ <b className="text-slate-200">{rule.normalized_payee_override}</b>
                      </span>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Desktop Rules Table (>= md) */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-900 text-slate-400 uppercase text-[10px] tracking-wider border-b border-slate-800">
              <tr>
                <th className="p-3.5">Priority</th>
                <th className="p-3.5">Pattern Type</th>
                <th className="p-3.5">Pattern</th>
                <th className="p-3.5">Assigned Category</th>
                <th className="p-3.5">Payee Override</th>
                <th className="p-3.5 text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-medium">
              {isLoading ? (
                <tr>
                  <td colSpan={6} className="text-center py-12 text-slate-400">
                    Loading rules...
                  </td>
                </tr>
              ) : rules.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center py-12 text-slate-500">
                    No categorization rules created yet.
                  </td>
                </tr>
              ) : (
                rules.map((rule) => {
                  const cat = categories.find((c) => c.id === rule.category_id);
                  return (
                    <tr key={rule.id} className="hover:bg-slate-800/40 text-slate-200">
                      <td className="p-3.5 font-mono text-[11px] text-slate-400">
                        #{rule.priority}
                      </td>
                      <td className="p-3.5">
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold bg-slate-800 text-slate-300">
                          {rule.pattern_type}
                        </span>
                      </td>
                      <td className="p-3.5 font-mono text-indigo-300 font-bold">
                        {rule.pattern}
                      </td>
                      <td className="p-3.5">
                        <div className="flex items-center gap-2">
                          <span
                            className="w-2.5 h-2.5 rounded-full"
                            style={{ backgroundColor: cat?.color || "#6366f1" }}
                          ></span>
                          <span>{cat?.name || "Unknown"}</span>
                        </div>
                      </td>
                      <td className="p-3.5 text-slate-400">
                        {rule.normalized_payee_override || "-"}
                      </td>
                      <td className="p-3.5 text-center">
                        <button
                          onClick={() => handleDeleteRule(rule.id)}
                          className="p-1 text-slate-400 hover:text-rose-400 transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create Rule Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs animate-in fade-in">
          <form
            onSubmit={handleCreateRule}
            className="w-full max-w-md rounded-2xl bg-slate-900 border border-slate-800 shadow-2xl p-6 space-y-4"
          >
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-base font-bold text-slate-100">Create Categorization Rule</h3>
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
                <label className="block text-slate-400 mb-1">Pattern (Keyword / Regex)</label>
                <input
                  type="text"
                  placeholder="e.g. TRADER JOE or NETFLIX"
                  value={newRule.pattern}
                  onChange={(e) => setNewRule({ ...newRule, pattern: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-200 font-mono"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 mb-1">Match Type</label>
                  <select
                    value={newRule.pattern_type}
                    onChange={(e) =>
                      setNewRule({ ...newRule, pattern_type: e.target.value as RulePatternType })
                    }
                    className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-200"
                  >
                    <option value="CONTAINS">CONTAINS</option>
                    <option value="EXACT">EXACT</option>
                    <option value="STARTS_WITH">STARTS_WITH</option>
                    <option value="REGEX">REGEX</option>
                  </select>
                </div>

                <div>
                  <label className="block text-slate-400 mb-1">Priority (1 = Highest)</label>
                  <input
                    type="number"
                    value={newRule.priority}
                    onChange={(e) =>
                      setNewRule({ ...newRule, priority: parseInt(e.target.value) || 10 })
                    }
                    className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-200"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Assign Category</label>
                <select
                  value={newRule.category_id}
                  onChange={(e) => setNewRule({ ...newRule, category_id: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-200"
                >
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Clean Payee Override (Optional)</label>
                <input
                  type="text"
                  placeholder="e.g. Trader Joe's"
                  value={newRule.normalized_payee_override}
                  onChange={(e) =>
                    setNewRule({ ...newRule, normalized_payee_override: e.target.value })
                  }
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-200"
                />
              </div>
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
                Save Rule
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
