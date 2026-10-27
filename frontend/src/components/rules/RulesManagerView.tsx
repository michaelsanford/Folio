import React, { useState, useEffect } from "react";
import {
  Plus,
  Trash2,
  CheckCircle2,
  Sparkles,
  Play,
  Layers,
  Bot,
  History,
  Cpu,
  ShieldCheck,
  Zap,
  RefreshCw,
  AlertCircle,
  HelpCircle,
} from "lucide-react";
import type {
  CategorizationRule,
  Category,
  RulePatternType,
  Account,
  ClassificationResult,
  ClassificationStatus,
  ClassificationTier,
} from "../../types";
import { api } from "../../services/api";

interface RulesManagerViewProps {
  categories: Category[];
  accounts?: Account[];
  onDataModified?: () => void;
}

export const RulesManagerView: React.FC<RulesManagerViewProps> = ({
  categories,
  accounts: propAccounts,
  onDataModified,
}) => {
  // Tab state: "rules" | "sandbox"
  const [activeTab, setActiveTab] = useState<"rules" | "sandbox">("rules");

  // Rules list state
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

  // Accounts state (from props or loaded dynamically)
  const [accounts, setAccounts] = useState<Account[]>(propAccounts || []);

  // Simple Rule Matcher Sandbox (inside Active Rules tab)
  const [testPayee, setTestPayee] = useState("");
  const [testAmount, setTestAmount] = useState(-25.5);
  const [testResult, setTestResult] = useState<{
    matched: boolean;
    suggested_category_id?: string;
    suggested_payee?: string;
  } | null>(null);

  // Classification Engine & Sandbox State
  const [engineStatus, setEngineStatus] = useState<ClassificationStatus | null>(null);
  const [isStatusLoading, setIsStatusLoading] = useState(false);

  // Interactive Classifier Sandbox Form State
  const [sandboxPayee, setSandboxPayee] = useState("TIM HORTONS #4921 TORONTO ON");
  const [sandboxAmount, setSandboxAmount] = useState<number | string>(-4.85);
  const [sandboxAccountId, setSandboxAccountId] = useState<string>("");
  const [sandboxEnableBedrock, setSandboxEnableBedrock] = useState(false);
  const [isClassifying, setIsClassifying] = useState(false);
  const [classificationResult, setClassificationResult] = useState<ClassificationResult | null>(null);
  const [classificationError, setClassificationError] = useState<string | null>(null);

  // Batch Auto-Classify State
  const [minConfidence, setMinConfidence] = useState(0.75);
  const [batchEnableBedrock, setBatchEnableBedrock] = useState(false);
  const [isBatchRunning, setIsBatchRunning] = useState(false);
  const [batchResultSummary, setBatchResultSummary] = useState<string | null>(null);
  const [batchError, setBatchError] = useState<string | null>(null);

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

  const loadEngineStatus = async () => {
    setIsStatusLoading(true);
    try {
      const status = await api.classification.getStatus();
      setEngineStatus(status);
      if (status.bedrock_enabled) {
        setSandboxEnableBedrock(true);
        setBatchEnableBedrock(true);
      }
    } catch (err) {
      console.warn("Could not load classification status, using default state", err);
      setEngineStatus({
        bedrock_enabled: false,
        bedrock_model_id: "amazon.nova-micro-v1:0",
        bedrock_region: "ca-central-1",
        confidence_threshold: 0.75,
        rules_count: rules.length,
        historical_matches_available: true,
      });
    } finally {
      setIsStatusLoading(false);
    }
  };

  useEffect(() => {
    loadRules();
    loadEngineStatus();
    if (!propAccounts || propAccounts.length === 0) {
      api.getAccounts().then(setAccounts).catch(console.error);
    }
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
      loadEngineStatus();
    } catch (err: any) {
      alert(`Create rule failed: ${err.message}`);
    }
  };

  const handleDeleteRule = async (id: string) => {
    if (!confirm("Are you sure you want to delete this rule?")) return;
    try {
      await api.deleteRule(id);
      loadRules();
      loadEngineStatus();
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

  // Run live classification in Sandbox
  const handleRunLiveClassification = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!sandboxPayee.trim()) return;

    setIsClassifying(true);
    setClassificationError(null);
    try {
      const res = await api.classification.evaluate({
        raw_payee: sandboxPayee.trim(),
        amount: sandboxAmount !== "" ? Number(sandboxAmount) : undefined,
        account_id: sandboxAccountId || undefined,
        enable_bedrock: sandboxEnableBedrock,
      });
      setClassificationResult(res);
    } catch (err: any) {
      setClassificationError(err.message || "Failed to evaluate transaction");
    } finally {
      setIsClassifying(false);
    }
  };

  // Run batch auto-classification across uncategorized transactions
  const handleRunBatchAutoClassify = async () => {
    setIsBatchRunning(true);
    setBatchResultSummary(null);
    setBatchError(null);
    try {
      const res = await api.classification.autoClassifyUncategorized({
        min_confidence: minConfidence,
        enable_bedrock: batchEnableBedrock,
        dry_run: false,
      });
      const classified = res.classified_count ?? res.updated_count ?? 0;
      const remaining = res.remaining_count ?? 0;
      setBatchResultSummary(`${classified} transactions classified, ${remaining} remaining uncategorized`);
      if (onDataModified) {
        onDataModified();
      }
    } catch (err: any) {
      setBatchError(err.message || "Batch auto-classification failed");
    } finally {
      setIsBatchRunning(false);
    }
  };

  const getTierBadge = (tier: ClassificationTier) => {
    switch (tier) {
      case "EXPLICIT_RULE":
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-blue-500/10 text-blue-500 border border-blue-500/20">
            <ShieldCheck className="w-3 h-3" /> Rule
          </span>
        );
      case "USER_HISTORY":
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
            <History className="w-3 h-3" /> User History
          </span>
        );
      case "HEURISTIC":
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-amber-500/10 text-amber-500 border border-amber-500/20">
            <Cpu className="w-3 h-3" /> Heuristics
          </span>
        );
      case "BEDROCK_AI":
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-purple-500/10 text-purple-500 border border-purple-500/20">
            <Bot className="w-3 h-3" /> Bedrock AI
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-surface-subtle text-muted border border-subtle">
            <HelpCircle className="w-3 h-3" /> Unclassified
          </span>
        );
    }
  };

  const getConfidenceLabel = (confidence: number) => {
    if (confidence >= 0.85) return "High Confidence";
    if (confidence >= 0.65) return "Medium Confidence";
    return "Low Confidence";
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header & Tab Switcher */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4 p-4 sm:p-6 rounded-2xl bg-surface border border-default shadow-xs">
        <div>
          <h1 className="text-lg sm:text-xl font-bold text-main">Categorization & Rules</h1>
          <p className="text-xs text-muted mt-1">
            Configure deterministic rules or test the multi-tier auto-classification engine.
          </p>
        </div>

        {/* Tab Switcher */}
        <div className="flex items-center gap-1.5 p-1 bg-surface-subtle border border-default rounded-xl self-start sm:self-auto">
          <button
            type="button"
            onClick={() => setActiveTab("rules")}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
              activeTab === "rules"
                ? "bg-surface text-main shadow-xs border border-default"
                : "text-muted hover:text-main"
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>Active Rules</span>
            <span className="px-1.5 py-0.2 rounded-full text-[10px] font-mono bg-surface-subtle border border-subtle text-sub">
              {rules.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => {
              setActiveTab("sandbox");
              loadEngineStatus();
            }}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
              activeTab === "sandbox"
                ? "bg-surface text-main shadow-xs border border-default"
                : "text-muted hover:text-main"
            }`}
          >
            <Sparkles className="w-3.5 h-3.5 text-accent-main" />
            <span>Classification Engine & Sandbox</span>
          </button>
        </div>
      </div>

      {/* TAB 1: ACTIVE RULES */}
      {activeTab === "rules" && (
        <div className="space-y-6">
          {/* Action Row */}
          <div className="flex items-center justify-between">
            <div className="text-xs text-muted">
              Rules are evaluated sequentially from priority 1 upward during statement ingestion.
            </div>
            <button
              onClick={() => setIsModalOpen(true)}
              className="flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-accent-main hover:bg-accent-main text-accent-contrast text-xs font-semibold shadow-xs cursor-pointer"
            >
              <Plus className="w-4 h-4" /> Create New Rule
            </button>
          </div>

          {/* Simple Matcher Sandbox */}
          <div className="p-4 sm:p-6 rounded-2xl bg-surface border border-default shadow-xs space-y-4">
            <div className="flex items-center gap-2 text-sm font-bold text-main">
              <Sparkles className="w-4 h-4 text-accent-main" />
              <span>Interactive Rule Testing Sandbox</span>
            </div>
            <p className="text-xs text-muted">
              Type a raw bank statement string below to test if your active rules match and what category/payee will be assigned.
            </p>

            <div className="flex flex-col sm:flex-row flex-wrap items-stretch sm:items-center gap-2.5">
              <input
                type="text"
                placeholder="e.g. SQ *BLUE BOTTLE COFFEE #12"
                value={testPayee}
                onChange={(e) => setTestPayee(e.target.value)}
                className="flex-1 w-full sm:w-auto sm:min-w-[220px] px-3 py-2 bg-input border border-default rounded-xl text-xs text-main font-mono"
              />
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  step="0.01"
                  placeholder="Amount"
                  value={testAmount}
                  onChange={(e) => setTestAmount(parseFloat(e.target.value) || 0)}
                  className="w-24 sm:w-28 px-3 py-2 bg-input border border-default rounded-xl text-xs text-main font-mono"
                />
                <button
                  onClick={handleTestMatch}
                  className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-2 bg-accent-subtle border border-accent-main/30 text-accent-subtle hover:bg-accent-subtle/80 rounded-xl text-xs font-semibold cursor-pointer"
                >
                  <Play className="w-3.5 h-3.5" /> Test Match
                </button>
              </div>
            </div>

            {testResult && (
              <div
                className={`p-4 rounded-xl text-xs border ${
                  testResult.matched
                    ? "bg-positive-subtle border-emerald-500/30 text-positive"
                    : "bg-surface-subtle border-subtle text-muted"
                }`}
              >
                {testResult.matched ? (
                  <div className="flex items-center gap-3">
                    <CheckCircle2 className="w-5 h-5 text-positive shrink-0" />
                    <div>
                      <div className="font-bold">Match Found!</div>
                      <div className="text-[11px] mt-0.5">
                        Category:{" "}
                        <b className="text-main">
                          {categories.find((c) => c.id === testResult.suggested_category_id)?.name ||
                            "Unknown"}
                        </b>{" "}
                        • Clean Payee: <b className="text-main">{testResult.suggested_payee || testPayee}</b>
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
          <div className="rounded-2xl border border-default bg-surface overflow-hidden shadow-xs">
            {/* Mobile Rules Feed (< md) */}
            <div className="block md:hidden divide-y divide-subtle font-medium">
              {isLoading ? (
                <div className="p-8 text-center text-muted text-xs">Loading rules...</div>
              ) : rules.length === 0 ? (
                <div className="p-8 text-center text-muted text-xs">No categorization rules created yet.</div>
              ) : (
                rules.map((rule) => {
                  const cat = categories.find((c) => c.id === rule.category_id);
                  return (
                    <div key={rule.id} className="p-3.5 space-y-2 hover:bg-surface-hover">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-[10px] text-muted">#{rule.priority}</span>
                          <span className="px-2 py-0.5 rounded-full text-[9px] font-mono font-semibold bg-surface-subtle text-muted border border-subtle">
                            {rule.pattern_type}
                          </span>
                        </div>
                        <button
                          onClick={() => handleDeleteRule(rule.id)}
                          className="p-1 text-muted hover:text-negative cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      <div className="font-mono text-xs text-accent-main font-bold break-all">
                        {rule.pattern}
                      </div>

                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs pt-1 border-t border-subtle">
                        <div className="flex items-center gap-1.5">
                          <span
                            className="w-2 h-2 rounded-full"
                            style={{ backgroundColor: cat?.color || "#10B981" }}
                          ></span>
                          <span className="text-main text-[11px]">{cat?.name || "Unknown"}</span>
                        </div>
                        {rule.normalized_payee_override && (
                          <span className="text-[11px] text-muted">
                            → <b className="text-main">{rule.normalized_payee_override}</b>
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
                <thead className="bg-surface-subtle text-muted uppercase text-[10px] tracking-wider border-b border-subtle font-semibold">
                  <tr>
                    <th className="p-3.5">Priority</th>
                    <th className="p-3.5">Pattern Type</th>
                    <th className="p-3.5">Pattern</th>
                    <th className="p-3.5">Assigned Category</th>
                    <th className="p-3.5">Payee Override</th>
                    <th className="p-3.5 text-center">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-subtle font-medium">
                  {isLoading ? (
                    <tr>
                      <td colSpan={6} className="text-center py-12 text-muted">
                        Loading rules...
                      </td>
                    </tr>
                  ) : rules.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="text-center py-12 text-muted">
                        No categorization rules created yet.
                      </td>
                    </tr>
                  ) : (
                    rules.map((rule) => {
                      const cat = categories.find((c) => c.id === rule.category_id);
                      return (
                        <tr key={rule.id} className="hover:bg-surface-hover text-main transition-colors">
                          <td className="p-3.5 font-mono text-[11px] text-muted">
                            #{rule.priority}
                          </td>
                          <td className="p-3.5">
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold bg-surface-subtle text-muted border border-subtle">
                              {rule.pattern_type}
                            </span>
                          </td>
                          <td className="p-3.5 font-mono text-accent-main font-bold">
                            {rule.pattern}
                          </td>
                          <td className="p-3.5">
                            <div className="flex items-center gap-2">
                              <span
                                className="w-2.5 h-2.5 rounded-full"
                                style={{ backgroundColor: cat?.color || "#10B981" }}
                              ></span>
                              <span>{cat?.name || "Unknown"}</span>
                            </div>
                          </td>
                          <td className="p-3.5 text-muted">
                            {rule.normalized_payee_override || "-"}
                          </td>
                          <td className="p-3.5 text-center">
                            <button
                              onClick={() => handleDeleteRule(rule.id)}
                              className="p-1 text-muted hover:text-negative transition-colors cursor-pointer"
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
        </div>
      )}

      {/* TAB 2: CLASSIFICATION ENGINE & SANDBOX */}
      {activeTab === "sandbox" && (
        <div className="space-y-6">
          {/* Engine Status Banner */}
          <div className="p-5 rounded-2xl bg-surface border border-default shadow-xs space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-bold text-main">
                <Zap className="w-4 h-4 text-accent-main" />
                <span>Cascading Multi-Tier Classification Architecture</span>
              </div>
              <button
                type="button"
                onClick={loadEngineStatus}
                disabled={isStatusLoading}
                className="flex items-center gap-1.5 text-xs text-muted hover:text-main cursor-pointer"
                title="Refresh Status"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isStatusLoading ? "animate-spin" : ""}`} />
                <span>Refresh</span>
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
              {/* Tier 1: Local Rules */}
              <div className="p-3.5 rounded-xl border border-default bg-surface-subtle/50 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold text-blue-500 uppercase tracking-wider flex items-center gap-1">
                    <ShieldCheck className="w-3 h-3" /> Tier 1
                  </span>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
                    Active
                  </span>
                </div>
                <div className="text-xs font-bold text-main">Local Rules</div>
                <div className="text-[11px] text-muted leading-relaxed">
                  {engineStatus?.rules_count ?? rules.length} explicit pattern & regex rules (100% confidence)
                </div>
              </div>

              {/* Tier 2: User History */}
              <div className="p-3.5 rounded-xl border border-default bg-surface-subtle/50 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold text-emerald-500 uppercase tracking-wider flex items-center gap-1">
                    <History className="w-3 h-3" /> Tier 2
                  </span>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
                    Active
                  </span>
                </div>
                <div className="text-xs font-bold text-main">User History</div>
                <div className="text-[11px] text-muted leading-relaxed">
                  Bayesian frequency match from past categorized ledger entries (85–98% confidence)
                </div>
              </div>

              {/* Tier 3: Heuristics */}
              <div className="p-3.5 rounded-xl border border-default bg-surface-subtle/50 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold text-amber-500 uppercase tracking-wider flex items-center gap-1">
                    <Cpu className="w-3 h-3" /> Tier 3
                  </span>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
                    Active
                  </span>
                </div>
                <div className="text-xs font-bold text-main">Heuristics</div>
                <div className="text-[11px] text-muted leading-relaxed">
                  Bilingual token taxonomy, amount magnitude & cash-flow direction
                </div>
              </div>

              {/* Tier 4: Bedrock AI */}
              <div className="p-3.5 rounded-xl border border-default bg-surface-subtle/50 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold text-purple-500 uppercase tracking-wider flex items-center gap-1">
                    <Bot className="w-3 h-3" /> Tier 4
                  </span>
                  {engineStatus?.bedrock_enabled ? (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-purple-500/10 text-purple-500 border border-purple-500/20">
                      Enabled
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-surface-subtle text-muted border border-subtle">
                      Disabled (Offline)
                    </span>
                  )}
                </div>
                <div className="text-xs font-bold text-main">Bedrock AI Recourse</div>
                <div className="text-[11px] text-muted leading-relaxed">
                  {engineStatus?.bedrock_enabled
                    ? `${engineStatus.bedrock_model_id} (${engineStatus.bedrock_region})`
                    : "Zero external network calls; runs 100% offline"}
                </div>
              </div>
            </div>
          </div>

          {/* Live Interactive Classifier Sandbox */}
          <div className="p-5 rounded-2xl bg-surface border border-default shadow-xs space-y-5">
            <div className="flex items-center gap-2 text-sm font-bold text-main">
              <Sparkles className="w-4 h-4 text-accent-main" />
              <span>Live Interactive Classifier Sandbox</span>
            </div>
            <p className="text-xs text-muted">
              Simulate how the multi-tier cascading classification engine processes transactions. Enter a raw bank statement string, amount, and account to observe the cascading tier resolution and confidence diagnostic.
            </p>

            <form
              onSubmit={handleRunLiveClassification}
              data-testid="live-classifier-form"
              className="space-y-4"
            >
              <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
                {/* Raw Payee Input */}
                <div className="md:col-span-5 space-y-1.5">
                  <label className="block text-xs font-medium text-sub">Raw Payee String</label>
                  <input
                    type="text"
                    placeholder="e.g. TIM HORTONS #4921 TORONTO ON"
                    value={sandboxPayee}
                    onChange={(e) => setSandboxPayee(e.target.value)}
                    className="w-full px-3 py-2 bg-input border border-default rounded-xl text-xs text-main font-mono placeholder:text-muted"
                    required
                  />
                </div>

                {/* Amount Input */}
                <div className="md:col-span-2 space-y-1.5">
                  <label className="block text-xs font-medium text-sub">Amount ($)</label>
                  <input
                    type="number"
                    step="0.01"
                    placeholder="-4.85"
                    value={sandboxAmount}
                    onChange={(e) => setSandboxAmount(e.target.value)}
                    className="w-full px-3 py-2 bg-input border border-default rounded-xl text-xs text-main font-mono"
                  />
                </div>

                {/* Account Selector */}
                <div className="md:col-span-3 space-y-1.5">
                  <label className="block text-xs font-medium text-sub">Account (Context)</label>
                  <select
                    value={sandboxAccountId}
                    onChange={(e) => setSandboxAccountId(e.target.value)}
                    className="w-full px-3 py-2 bg-input border border-default rounded-xl text-xs font-medium text-main"
                  >
                    <option value="">Any / General Account</option>
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name} ({a.type})
                      </option>
                    ))}
                  </select>
                </div>

                {/* Submit Action */}
                <div className="md:col-span-2 flex flex-col justify-end">
                  <button
                    type="submit"
                    onClick={handleRunLiveClassification}
                    disabled={isClassifying || !sandboxPayee.trim()}
                    className="flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-accent-main hover:bg-accent-main text-accent-contrast text-xs font-semibold shadow-xs disabled:opacity-50 cursor-pointer w-full"
                  >
                    {isClassifying ? (
                      <>
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        <span>Classifying...</span>
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-3.5 h-3.5" />
                        <span>Classify</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Enable Bedrock Recourse Checkbox */}
              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="sandboxEnableBedrock"
                  checked={sandboxEnableBedrock}
                  onChange={(e) => setSandboxEnableBedrock(e.target.checked)}
                  className="rounded border-default bg-input text-accent-main focus:ring-accent-main"
                />
                <label htmlFor="sandboxEnableBedrock" className="text-xs text-sub cursor-pointer select-none">
                  Enable Bedrock AI Recourse fallback if local heuristics confidence is insufficient
                </label>
              </div>
            </form>

            {classificationError && (
              <div className="p-3.5 rounded-xl bg-negative-subtle border border-rose-500/30 text-xs text-negative flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{classificationError}</span>
              </div>
            )}

            {/* Results Card */}
            {classificationResult && (
              <div className="p-5 rounded-xl border border-default bg-surface-subtle/40 space-y-4 animate-in fade-in">
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-3 border-b border-subtle">
                  <div className="space-y-1">
                    <span className="text-[10px] uppercase font-bold text-muted tracking-wider">Classification Result</span>
                    <div className="flex items-center gap-2 flex-wrap">
                      <div className="flex items-center gap-1.5">
                        <span
                          className="w-3 h-3 rounded-full shrink-0"
                          style={{
                            backgroundColor:
                              classificationResult.category_color ||
                              categories.find((c) => c.id === classificationResult.category_id)?.color ||
                              "#3B82F6",
                          }}
                        />
                        <span className="text-sm font-bold text-main">
                          {classificationResult.category_name ||
                            categories.find((c) => c.id === classificationResult.category_id)?.name ||
                            (classificationResult.matched ? "Matched" : "Uncategorized")}
                        </span>
                      </div>
                      {getTierBadge(classificationResult.tier)}
                    </div>
                  </div>

                  {/* Confidence meter */}
                  <div className="w-full sm:w-56 space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-main">
                        {Math.round(classificationResult.confidence * 100)}%
                      </span>
                      <span className="text-[11px] text-muted font-medium">
                        {getConfidenceLabel(classificationResult.confidence)}
                      </span>
                    </div>
                    <div className="w-full h-2 bg-surface rounded-full overflow-hidden border border-subtle">
                      <div
                        className={`h-full transition-all duration-500 ${
                          classificationResult.confidence >= 0.85
                            ? "bg-emerald-500"
                            : classificationResult.confidence >= 0.65
                            ? "bg-amber-500"
                            : "bg-slate-400"
                        }`}
                        style={{
                          width: `${Math.min(100, Math.max(0, classificationResult.confidence * 100))}%`,
                        }}
                      />
                    </div>
                  </div>
                </div>

                {/* Details Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-xs">
                  <div className="p-3 rounded-lg bg-surface border border-subtle space-y-1">
                    <span className="text-[10px] text-muted font-medium uppercase">Normalized Payee</span>
                    <div className="font-semibold text-main font-mono truncate">
                      {classificationResult.normalized_payee || sandboxPayee}
                    </div>
                  </div>

                  <div className="p-3 rounded-lg bg-surface border border-subtle space-y-1">
                    <span className="text-[10px] text-muted font-medium uppercase">Matched Category ID</span>
                    <div className="font-semibold text-main font-mono truncate">
                      {classificationResult.category_id || "None"}
                    </div>
                  </div>

                  <div className="p-3 rounded-lg bg-surface border border-subtle space-y-1">
                    <span className="text-[10px] text-muted font-medium uppercase">Matching Tier</span>
                    <div className="font-semibold text-main font-mono">
                      {classificationResult.tier}
                    </div>
                  </div>
                </div>

                {/* Diagnostic Reason */}
                <div className="p-3.5 rounded-lg bg-surface border border-subtle space-y-1 text-xs">
                  <span className="text-[10px] text-muted font-bold uppercase tracking-wider">Detailed Diagnostic Reason</span>
                  <div className="text-sub font-mono leading-relaxed break-words">
                    {classificationResult.reason || "Engine evaluated successfully."}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Batch Auto-Classify Uncategorized Transactions Card */}
          <div className="p-5 rounded-2xl bg-surface border border-default shadow-xs space-y-4">
            <div className="flex items-center gap-2 text-sm font-bold text-main">
              <Zap className="w-4 h-4 text-accent-main" />
              <span>Batch Auto-Classify Uncategorized Transactions</span>
            </div>
            <p className="text-xs text-muted">
              Scan all transactions currently in the ledger lacking a category and evaluate them against the multi-tier cascading classification engine.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4 rounded-xl bg-surface-subtle/50 border border-subtle text-xs">
              {/* Confidence Threshold Slider */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label htmlFor="minConfidenceSlider" className="font-medium text-main">Minimum Confidence Threshold</label>
                  <span className="font-mono font-bold text-accent-main">
                    {Math.round(minConfidence * 100)}%
                  </span>
                </div>
                <input
                  id="minConfidenceSlider"
                  type="range"
                  min="0.50"
                  max="0.95"
                  step="0.05"
                  value={minConfidence}
                  onChange={(e) => setMinConfidence(parseFloat(e.target.value))}
                  className="w-full accent-accent-main cursor-pointer"
                />
                <p className="text-[11px] text-muted">
                  Transactions with classification score below {Math.round(minConfidence * 100)}% will remain uncategorized for manual review.
                </p>
              </div>

              {/* Options & Action */}
              <div className="space-y-3 flex flex-col justify-between">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="batchEnableBedrock"
                    checked={batchEnableBedrock}
                    onChange={(e) => setBatchEnableBedrock(e.target.checked)}
                    className="rounded border-default bg-input text-accent-main focus:ring-accent-main"
                  />
                  <label htmlFor="batchEnableBedrock" className="text-xs text-sub cursor-pointer select-none">
                    Use Bedrock AI Recourse for ambiguous long-tail payees
                  </label>
                </div>

                <button
                  type="button"
                  onClick={handleRunBatchAutoClassify}
                  disabled={isBatchRunning}
                  className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-accent-main hover:bg-accent-main text-accent-contrast text-xs font-semibold shadow-xs disabled:opacity-50 cursor-pointer w-full sm:w-auto"
                >
                  {isBatchRunning ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Classifying Uncategorized Transactions...</span>
                    </>
                  ) : (
                    <>
                      <Zap className="w-3.5 h-3.5" />
                      <span>Run Auto-Classification</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            {batchError && (
              <div className="p-3.5 rounded-xl bg-negative-subtle border border-rose-500/30 text-xs text-negative flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{batchError}</span>
              </div>
            )}

            {batchResultSummary && (
              <div className="p-4 rounded-xl bg-positive-subtle border border-emerald-500/30 text-xs text-positive flex items-center gap-3 animate-in fade-in">
                <CheckCircle2 className="w-5 h-5 text-positive shrink-0" />
                <div>
                  <div className="font-bold">Batch Auto-Classification Complete</div>
                  <div className="text-[11px] mt-0.5 text-main font-semibold">{batchResultSummary}</div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Create Rule Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in">
          <form
            onSubmit={handleCreateRule}
            className="w-full max-w-md rounded-2xl bg-surface border border-default shadow-2xl p-6 space-y-4"
          >
            <div className="flex items-center justify-between border-b border-subtle pb-3">
              <h3 className="text-base font-bold text-main">Create Categorization Rule</h3>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="text-muted hover:text-main"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-muted mb-1 font-medium">Pattern (Keyword / Regex)</label>
                <input
                  type="text"
                  placeholder="e.g. TRADER JOE or NETFLIX"
                  value={newRule.pattern}
                  onChange={(e) => setNewRule({ ...newRule, pattern: e.target.value })}
                  className="w-full px-3 py-2 bg-input border border-default rounded-xl text-main font-mono"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-muted mb-1 font-medium">Match Type</label>
                  <select
                    value={newRule.pattern_type}
                    onChange={(e) =>
                      setNewRule({ ...newRule, pattern_type: e.target.value as RulePatternType })
                    }
                    className="w-full px-3 py-2 bg-input border border-default rounded-xl text-main"
                  >
                    <option value="CONTAINS">CONTAINS</option>
                    <option value="EXACT">EXACT</option>
                    <option value="STARTS_WITH">STARTS_WITH</option>
                    <option value="REGEX">REGEX</option>
                  </select>
                </div>

                <div>
                  <label className="block text-muted mb-1 font-medium">Priority (1 = Highest)</label>
                  <input
                    type="number"
                    value={newRule.priority}
                    onChange={(e) =>
                      setNewRule({ ...newRule, priority: parseInt(e.target.value) || 10 })
                    }
                    className="w-full px-3 py-2 bg-input border border-default rounded-xl text-main font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block text-muted mb-1 font-medium">Assign Category</label>
                <select
                  value={newRule.category_id}
                  onChange={(e) => setNewRule({ ...newRule, category_id: e.target.value })}
                  className="w-full px-3 py-2 bg-input border border-default rounded-xl text-main"
                >
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-muted mb-1 font-medium">Clean Payee Override (Optional)</label>
                <input
                  type="text"
                  placeholder="e.g. Trader Joe's"
                  value={newRule.normalized_payee_override}
                  onChange={(e) =>
                    setNewRule({ ...newRule, normalized_payee_override: e.target.value })
                  }
                  className="w-full px-3 py-2 bg-input border border-default rounded-xl text-main"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-subtle">
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="px-4 py-2 rounded-xl border border-default text-sub text-xs hover:bg-surface-hover"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-xl bg-accent-main hover:bg-accent-main text-accent-contrast text-xs font-semibold shadow-xs cursor-pointer"
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
