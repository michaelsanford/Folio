import React, { useState, useEffect } from "react";
import { Plus, Trash2, RefreshCw, AlertCircle, X, ChevronRight } from "lucide-react";
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
import { NumberField } from "../common/NumberField";
import {
  checkboxClass,
  chipTab,
  dangerIconButton as deleteButton,
  hairline,
  iconButton,
  inputClass,
  labelText,
  loneText,
  modalOverlay,
  pageStack,
  primaryButton,
  secondaryButton,
  section,
  sectionHeader,
  sectionSub,
  sectionTitle,
  segmentTrack,
} from "../common/ui";
import { ActionSheet, DetailList } from "../common/ActionSheet";

const PATTERN_TYPE_LABELS: Record<RulePatternType, string> = {
  CONTAINS: "Contains",
  EXACT: "Exact",
  STARTS_WITH: "Starts with",
  REGEX: "Regex",
};

const fieldLabel = "block text-sm text-sub mb-2";

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
  // Phones: a rule row opens this sheet with its details and Delete.
  const [sheetRuleId, setSheetRuleId] = useState<string | null>(null);
  const [newRule, setNewRule] = useState<{
    category_id: string;
    pattern: string;
    pattern_type: RulePatternType;
    priority: number | null;
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
  const [testAmount, setTestAmount] = useState<number | null>(-25.5);
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
      await api.createRule({ ...newRule, priority: newRule.priority ?? 10 });
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
        amount: testAmount ?? 0,
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
    const label =
      tier === "EXPLICIT_RULE"
        ? "Rule"
        : tier === "USER_HISTORY"
        ? "User history"
        : tier === "HEURISTIC"
        ? "Heuristics"
        : tier === "BEDROCK_AI"
        ? "AI"
        : "Unclassified";
    return (
      <span className="rounded-md px-1.5 py-0.5 text-sm bg-surface-subtle text-sub">{label}</span>
    );
  };

  const getConfidenceLabel = (confidence: number) => {
    if (confidence >= 0.85) return "High confidence";
    if (confidence >= 0.65) return "Medium confidence";
    return "Low confidence";
  };

  const tierCards: Array<{
    tier: string;
    title: string;
    description: string;
    active: boolean;
    status: string;
  }> = [
    {
      tier: "Tier 1",
      title: "Local rules",
      description: `${engineStatus?.rules_count ?? rules.length} explicit pattern and regex rules, 100% confidence`,
      active: true,
      status: "Active",
    },
    {
      tier: "Tier 2",
      title: "User history",
      description: "Frequency match on previously categorized ledger entries, 85–98% confidence",
      active: true,
      status: "Active",
    },
    {
      tier: "Tier 3",
      title: "Heuristics",
      description: "Bilingual token taxonomy, amount size and cash-flow direction",
      active: true,
      status: "Active",
    },
    {
      tier: "Tier 4",
      title: "AI model",
      description: engineStatus?.bedrock_enabled
        ? "Ambiguous payees are sent to a language model"
        : "No external network calls, runs fully offline",
      active: !!engineStatus?.bedrock_enabled,
      status: engineStatus?.bedrock_enabled ? "Enabled" : "Off",
    },
  ];

  const tabClass = (active: boolean) => `${chipTab(active)} -mb-px`;

  return (
    <div className={`max-w-7xl mx-auto ${pageStack}`}>
      {/* Header & Tab Switcher */}
      <header className="flex flex-col sm:flex-row items-stretch sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-semibold text-main">Rules</h1>
          <p className="text-sm text-sub mt-1">
            Set categorization rules or test the classification engine
          </p>
        </div>

        {/* Tab Switcher */}
        <div className={`${segmentTrack} self-start sm:self-auto`}>
          <button
            type="button"
            aria-pressed={activeTab === "rules"}
            onClick={() => setActiveTab("rules")}
            className={tabClass(activeTab === "rules")}
          >
            <span>Active rules</span>
            <span className="tabular-nums font-normal text-sub">{rules.length}</span>
          </button>

          <button
            type="button"
            aria-pressed={activeTab === "sandbox"}
            onClick={() => {
              setActiveTab("sandbox");
              loadEngineStatus();
            }}
            className={tabClass(activeTab === "sandbox")}
          >
            Classification engine
          </button>
        </div>
      </header>

      {/* TAB 1: ACTIVE RULES */}
      {activeTab === "rules" && (
        <div className={pageStack}>
          {/* Action Row */}
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="min-w-0 flex-1 basis-60 text-base text-sub">
              Rules run in priority order, starting from 1, when statements are imported
            </div>
            <button onClick={() => setIsModalOpen(true)} className={`${primaryButton} shrink-0`}>
              <Plus className="w-4 h-4" strokeWidth={1.5} /> New rule
            </button>
          </div>

          {/* Simple Matcher Sandbox */}
          <section className={section}>
            <div className={sectionHeader}>
              <h2 className={sectionTitle}>Test rules</h2>
              <p className={sectionSub}>
                Enter raw statement text to see which rule matches and what category and payee it assigns
              </p>
            </div>

            <div className="flex flex-col sm:flex-row flex-wrap items-stretch sm:items-center gap-2">
              <input
                type="text"
                placeholder="Statement text"
                aria-label="Statement text"
                value={testPayee}
                onChange={(e) => setTestPayee(e.target.value)}
                className={`${inputClass} min-w-0 sm:flex-1 sm:w-auto sm:min-w-[220px] font-mono`}
              />
              <div className="flex items-center gap-2">
                <NumberField
                  step="0.01"
                  placeholder="Amount"
                  aria-label="Amount"
                  value={testAmount}
                  onValueChange={setTestAmount}
                  className={`${inputClass} w-28 tabular-nums`}
                />
                <button onClick={handleTestMatch} className={`${secondaryButton} flex-1 sm:flex-none`}>
                  Test match
                </button>
              </div>
            </div>

            {testResult && (
              <div className={`mt-6 pt-4 ${hairline} text-base`}>
                {testResult.matched ? (
                  <div className="flex items-start gap-3">
                    <span className="w-2 h-2 rounded-full bg-positive mt-2 shrink-0" />
                    <div className="min-w-0">
                      <div className="font-semibold text-main">Match found</div>
                      <div className="text-sm text-sub mt-1 break-words">
                        Category{" "}
                        <span className="text-main">
                          {categories.find((c) => c.id === testResult.suggested_category_id)?.name ||
                            "Unknown"}
                        </span>{" "}
                        · Payee <span className="text-main">{testResult.suggested_payee || testPayee}</span>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="text-sub">
                    No rule matched this description and amount. It will fall back to the classification engine.
                  </div>
                )}
              </div>
            )}
          </section>

          {/* Rules Container */}
          <section className={section}>
            {/* Phone rules feed (< md): read-only; a tap opens the rule's sheet */}
            <div className="block md:hidden border-y border-subtle divide-y divide-[var(--border-subtle)]">
              {isLoading ? (
                <div role="status" className={`px-4 py-12 text-center ${loneText}`}>Loading rules…</div>
              ) : rules.length === 0 ? (
                <div className={`px-4 py-12 text-center ${loneText}`}>No rules yet</div>
              ) : (
                rules.map((rule) => {
                  const cat = categories.find((c) => c.id === rule.category_id);
                  return (
                    <button
                      key={rule.id}
                      type="button"
                      onClick={() => setSheetRuleId(rule.id)}
                      aria-label={`Rule ${rule.pattern}, details and actions`}
                      className="w-full px-1 py-4 flex items-start gap-3 text-left bg-surface-hover transition-colors cursor-pointer"
                    >
                      <div className="flex-1 min-w-0 space-y-1.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="tabular-nums text-sm text-sub">#{rule.priority}</span>
                          <span className="rounded-md px-1.5 py-0.5 text-sm bg-surface-subtle text-sub">
                            {PATTERN_TYPE_LABELS[rule.pattern_type] ?? rule.pattern_type}
                          </span>
                        </div>
                        <div className="font-mono text-base text-main break-all">{rule.pattern}</div>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                          <span className="flex items-center gap-2 min-w-0">
                            <span
                              className="w-2 h-2 rounded-full shrink-0"
                              style={{ backgroundColor: cat?.color || "var(--text-muted)" }}
                            ></span>
                            <span className="text-sub break-words">{cat?.name || "Unknown"}</span>
                          </span>
                          {rule.normalized_payee_override && (
                            <span className="text-sub break-words min-w-0">
                              → <span className="text-main">{rule.normalized_payee_override}</span>
                            </span>
                          )}
                        </div>
                      </div>
                      <ChevronRight className="w-5 h-5 mt-0.5 text-sub shrink-0" strokeWidth={1.5} aria-hidden="true" />
                    </button>
                  );
                })
              )}
            </div>

            {/* Rules table (tablet and desktop, >= md) */}
            <div className="hidden md:block border-b border-subtle">
              <table className="w-full table-fixed text-left text-sm">
                <thead className="border-y border-subtle">
                  <tr className="h-10 text-sm text-sub">
                    <th className="px-3 font-normal w-20">Priority</th>
                    <th className="px-3 font-normal w-28">Match type</th>
                    <th className="px-3 font-normal">Pattern</th>
                    <th className="px-3 font-normal w-[22%]">Category</th>
                    <th className="hidden xl:table-cell px-3 font-normal w-[18%]">Payee override</th>
                    <th className="px-3 font-normal w-14 pointer-coarse:w-16">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border-subtle)]">
                  {isLoading ? (
                    <tr>
                      <td colSpan={6} role="status" className={`text-center px-4 py-12 ${loneText}`}>
                        Loading rules…
                      </td>
                    </tr>
                  ) : rules.length === 0 ? (
                    <tr>
                      <td colSpan={6} className={`text-center px-4 py-12 ${loneText}`}>
                        No rules yet
                      </td>
                    </tr>
                  ) : (
                    rules.map((rule) => {
                      const cat = categories.find((c) => c.id === rule.category_id);
                      return (
                        <tr key={rule.id} className="h-12 text-main bg-surface-hover transition-colors align-middle">
                          <td className="px-3 tabular-nums text-sub">#{rule.priority}</td>
                          <td className="px-3">
                            <span className="rounded-md px-1.5 py-0.5 text-sm bg-surface-subtle text-sub whitespace-nowrap">
                              {PATTERN_TYPE_LABELS[rule.pattern_type] ?? rule.pattern_type}
                            </span>
                          </td>
                          <td className="px-3 min-w-0">
                            <div className="font-mono text-main break-all">
                              {rule.pattern}
                            </div>
                            {rule.normalized_payee_override && (
                              <div className="xl:hidden text-sm text-sub break-words">
                                → {rule.normalized_payee_override}
                              </div>
                            )}
                          </td>
                          <td className="px-3 min-w-0">
                            <div className="flex items-center gap-2 min-w-0">
                              <span
                                className="w-2 h-2 rounded-full shrink-0"
                                style={{ backgroundColor: cat?.color || "var(--text-muted)" }}
                              ></span>
                              <span className="break-words min-w-0">
                                {cat?.name || "Unknown"}
                              </span>
                            </div>
                          </td>
                          <td className="hidden xl:table-cell px-3 text-sub min-w-0">
                            <div className="break-words">
                              {rule.normalized_payee_override || <span className="text-sub">–</span>}
                            </div>
                          </td>
                          <td className="px-3 text-right">
                            <button
                              onClick={() => handleDeleteRule(rule.id)}
                              aria-label="Delete rule"
                              title="Delete rule"
                              className={`${deleteButton} ml-auto`}
                            >
                              <Trash2 className="w-4 h-4" strokeWidth={1.5} />
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}

      {/* TAB 2: CLASSIFICATION ENGINE & SANDBOX */}
      {activeTab === "sandbox" && (
        <div className={pageStack}>
          {/* Engine Status Banner */}
          <section className={section}>
            <div className={`flex flex-wrap items-start justify-between gap-x-4 gap-y-2 ${sectionHeader}`}>
              <div className="min-w-0">
                <h2 className={sectionTitle}>Classification tiers</h2>
                <p className={sectionSub}>
                  Each transaction goes through the tiers in order until one is confident enough
                </p>
              </div>
              <button
                type="button"
                onClick={loadEngineStatus}
                disabled={isStatusLoading}
                className={secondaryButton}
                title="Refresh status"
              >
                <RefreshCw
                  className={`w-4 h-4 ${isStatusLoading ? "animate-spin" : ""}`}
                  strokeWidth={1.5}
                />
                <span>Refresh</span>
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-8">
              {tierCards.map((t) => (
                <div key={t.tier} className={`min-w-0 pt-3 ${hairline}`}>
                  <div className="flex items-center justify-between gap-2 text-sm">
                    <span className="text-sub">{t.tier}</span>
                    <span className="inline-flex items-center gap-1.5 text-sub">
                      <span
                        className={`w-1.5 h-1.5 rounded-full ${
                          t.active ? "bg-positive" : "bg-[var(--text-muted)]"
                        }`}
                      />
                      {t.status}
                    </span>
                  </div>
                  <div className="mt-2 text-base font-semibold text-main">{t.title}</div>
                  <div className="mt-1 text-sm text-sub leading-relaxed">{t.description}</div>
                </div>
              ))}
            </div>
          </section>

          {/* Live Interactive Classifier Sandbox */}
          <section className={section}>
            <div className={sectionHeader}>
              <h2 className={sectionTitle}>Classifier sandbox</h2>
              <p className={sectionSub}>
                Enter raw statement text, an amount and an account to see which tier resolves it and how confident it is
              </p>
            </div>

            <form
              onSubmit={handleRunLiveClassification}
              data-testid="live-classifier-form"
              className="space-y-4"
            >
              <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
                {/* Raw Payee Input */}
                <div className="md:col-span-5">
                  <label htmlFor="sandboxPayee" className={fieldLabel}>Statement text</label>
                  <input
                    id="sandboxPayee"
                    type="text"
                    placeholder="TIM HORTONS #4921 TORONTO ON"
                    value={sandboxPayee}
                    onChange={(e) => setSandboxPayee(e.target.value)}
                    className={`${inputClass} font-mono`}
                    required
                  />
                </div>

                {/* Amount Input */}
                <div className="md:col-span-2">
                  <label htmlFor="sandboxAmount" className={fieldLabel}>Amount</label>
                  <input
                    id="sandboxAmount"
                    type="number"
                    step="0.01"
                    placeholder="-4.85"
                    value={sandboxAmount}
                    onChange={(e) => setSandboxAmount(e.target.value)}
                    className={`${inputClass} tabular-nums`}
                  />
                </div>

                {/* Account Selector */}
                <div className="md:col-span-3">
                  <label htmlFor="sandboxAccount" className={fieldLabel}>Account</label>
                  <select
                    id="sandboxAccount"
                    value={sandboxAccountId}
                    onChange={(e) => setSandboxAccountId(e.target.value)}
                    className={inputClass}
                  >
                    <option value="">Any account</option>
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
                    className={`${primaryButton} w-full disabled:opacity-50 disabled:cursor-not-allowed`}
                  >
                    {isClassifying ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin" strokeWidth={1.5} />
                        <span>Classifying…</span>
                      </>
                    ) : (
                      <span>Classify</span>
                    )}
                  </button>
                </div>
              </div>

              {/* Enable Bedrock Recourse Checkbox */}
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="sandboxEnableBedrock"
                  checked={sandboxEnableBedrock}
                  onChange={(e) => setSandboxEnableBedrock(e.target.checked)}
                  className={checkboxClass}
                />
                <label htmlFor="sandboxEnableBedrock" className="text-base md:text-sm text-sub cursor-pointer select-none">
                  Fall back to AI when local confidence is too low
                </label>
              </div>
            </form>

            {classificationError && (
              <div className="mt-4 p-4 rounded-lg bg-negative-subtle text-base text-negative flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" strokeWidth={1.5} />
                <span className="min-w-0 break-words">{classificationError}</span>
              </div>
            )}

            {/* Results Card */}
            {classificationResult && (
              <div className={`mt-8 pt-6 ${hairline} space-y-5 animate-in fade-in`}>
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                  <div className="min-w-0">
                    <span className={labelText}>Result</span>
                    <div className="mt-1 flex items-center gap-2 flex-wrap">
                      <div className="flex items-center gap-2">
                        <span
                          className="w-2 h-2 rounded-full shrink-0"
                          style={{
                            backgroundColor:
                              classificationResult.category_color ||
                              categories.find((c) => c.id === classificationResult.category_id)?.color ||
                              "var(--text-muted)",
                          }}
                        />
                        <span className="text-lg font-semibold text-main break-words">
                          {classificationResult.category_name ||
                            categories.find((c) => c.id === classificationResult.category_id)?.name ||
                            (classificationResult.matched ? "Matched" : "Uncategorized")}
                        </span>
                      </div>
                      {getTierBadge(classificationResult.tier)}
                    </div>
                  </div>

                  {/* Confidence meter */}
                  <div className="w-full sm:w-56 space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="tabular-nums text-main">
                        {Math.round(classificationResult.confidence * 100)}%
                      </span>
                      <span className="text-sub">
                        {getConfidenceLabel(classificationResult.confidence)}
                      </span>
                    </div>
                    <div className="w-full h-1.5 bg-surface-subtle rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-[width] duration-500 ${
                          classificationResult.confidence >= 0.85
                            ? "bg-positive"
                            : classificationResult.confidence >= 0.65
                            ? "bg-warning"
                            : "bg-[var(--text-muted)]"
                        }`}
                        style={{
                          width: `${Math.min(100, Math.max(0, classificationResult.confidence * 100))}%`,
                        }}
                      />
                    </div>
                  </div>
                </div>

                {/* Details Grid */}
                <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-4 text-base md:text-sm">
                  <div className="min-w-0">
                    <dt className={labelText}>Normalized payee</dt>
                    <dd className="mt-1 text-main font-mono break-all">
                      {classificationResult.normalized_payee || sandboxPayee}
                    </dd>
                  </div>

                  <div className="min-w-0">
                    <dt className={labelText}>Category ID</dt>
                    <dd className="mt-1 text-main font-mono break-all">
                      {classificationResult.category_id || "None"}
                    </dd>
                  </div>

                  <div className="min-w-0">
                    <dt className={labelText}>Tier</dt>
                    <dd className="mt-1 text-main font-mono">{classificationResult.tier}</dd>
                  </div>
                </dl>

                {/* Diagnostic Reason */}
                <div className="text-sm">
                  <span className={labelText}>Reason</span>
                  <div className="mt-1 text-sub font-mono text-sm leading-relaxed break-words">
                    {classificationResult.reason || "Engine evaluated successfully"}
                  </div>
                </div>
              </div>
            )}
          </section>

          {/* Batch Auto-Classify Uncategorized Transactions Card */}
          <section className={section}>
            <div className={sectionHeader}>
              <h2 className={sectionTitle}>Classify uncategorized transactions</h2>
              <p className={sectionSub}>
                Run every ledger transaction without a category through the classification engine
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-6 text-base md:text-sm">
              {/* Confidence Threshold Slider */}
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <label htmlFor="minConfidenceSlider" className="text-main">Minimum confidence</label>
                  <span className="tabular-nums text-main">
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
                  className="w-full accent-[var(--accent-primary)] cursor-pointer"
                />
                <p className="text-sm text-sub">
                  Transactions scoring below {Math.round(minConfidence * 100)}% stay uncategorized for manual review
                </p>
              </div>

              {/* Options & Action */}
              <div className="space-y-4 flex flex-col justify-between">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="batchEnableBedrock"
                    checked={batchEnableBedrock}
                    onChange={(e) => setBatchEnableBedrock(e.target.checked)}
                    className={checkboxClass}
                  />
                  <label htmlFor="batchEnableBedrock" className="text-base md:text-sm text-sub cursor-pointer select-none">
                    Use AI for ambiguous payees
                  </label>
                </div>

                <button
                  type="button"
                  onClick={handleRunBatchAutoClassify}
                  disabled={isBatchRunning}
                  className={`${primaryButton} w-full sm:w-auto sm:self-start disabled:opacity-50 disabled:cursor-not-allowed`}
                >
                  {isBatchRunning ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" strokeWidth={1.5} />
                      <span>Classifying transactions…</span>
                    </>
                  ) : (
                    <span>Run auto-classification</span>
                  )}
                </button>
              </div>
            </div>

            {batchError && (
              <div className="mt-4 p-4 rounded-lg bg-negative-subtle text-base text-negative flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" strokeWidth={1.5} />
                <span className="min-w-0 break-words">{batchError}</span>
              </div>
            )}

            {batchResultSummary && (
              <div className="mt-6 p-4 rounded-lg bg-positive-subtle text-base flex items-start gap-3 animate-in fade-in">
                <span className="w-2 h-2 rounded-full bg-positive mt-2 shrink-0" />
                <div className="min-w-0">
                  <div className="font-semibold text-main">Auto-classification complete</div>
                  <div className="text-sm mt-1 text-sub break-words">{batchResultSummary}</div>
                </div>
              </div>
            )}
          </section>
        </div>
      )}

      {/* Phone: a rule's details and actions */}
      {(() => {
        const rule = sheetRuleId ? rules.find((r) => r.id === sheetRuleId) : undefined;
        if (!rule) return null;
        const cat = categories.find((c) => c.id === rule.category_id);
        return (
          <ActionSheet
            open
            onClose={() => setSheetRuleId(null)}
            title={rule.pattern}
            subtitle={`Rule #${rule.priority}`}
            actions={[
              { label: "Delete rule", icon: Trash2, destructive: true, onSelect: () => void handleDeleteRule(rule.id) },
            ]}
          >
            <DetailList
              items={[
                ["Match type", PATTERN_TYPE_LABELS[rule.pattern_type] ?? rule.pattern_type],
                ["Pattern", <span className="font-mono break-all">{rule.pattern}</span>],
                ["Category", cat?.name || "Unknown"],
                !!rule.normalized_payee_override && ["Payee becomes", rule.normalized_payee_override],
                ["Priority", <span className="tabular-nums">{rule.priority}</span>],
              ]}
            />
          </ActionSheet>
        );
      })()}

      {/* Create Rule Modal */}
      {isModalOpen && (
        <div className={modalOverlay}>
          <form
            onSubmit={handleCreateRule}
            className="w-full md:max-w-md max-h-[92dvh] md:max-h-[90vh] overflow-y-auto rounded-t-2xl md:rounded-2xl bg-surface elevation-3 pb-[env(safe-area-inset-bottom)] md:pb-0 animate-in sheet-enter"
          >
            <div className="flex items-center justify-between gap-4 px-6 pt-6 pb-2">
              <h3 className={sectionTitle}>New rule</h3>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                aria-label="Close"
                className={iconButton}
              >
                <X className="w-4 h-4" strokeWidth={1.5} />
              </button>
            </div>

            <div className="px-6 py-4 space-y-4 text-base md:text-sm">
              <div>
                <label htmlFor="rulePattern" className={fieldLabel}>Pattern (keyword or regex)</label>
                <input
                  id="rulePattern"
                  type="text"
                  placeholder="NETFLIX"
                  value={newRule.pattern}
                  onChange={(e) => setNewRule({ ...newRule, pattern: e.target.value })}
                  className={`${inputClass} font-mono`}
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="ruleMatchType" className={fieldLabel}>Match type</label>
                  <select
                    id="ruleMatchType"
                    value={newRule.pattern_type}
                    onChange={(e) =>
                      setNewRule({ ...newRule, pattern_type: e.target.value as RulePatternType })
                    }
                    className={inputClass}
                  >
                    <option value="CONTAINS">{PATTERN_TYPE_LABELS.CONTAINS}</option>
                    <option value="EXACT">{PATTERN_TYPE_LABELS.EXACT}</option>
                    <option value="STARTS_WITH">{PATTERN_TYPE_LABELS.STARTS_WITH}</option>
                    <option value="REGEX">{PATTERN_TYPE_LABELS.REGEX}</option>
                  </select>
                </div>

                <div>
                  <label htmlFor="rulePriority" className={fieldLabel}>Priority (1 is highest)</label>
                  <NumberField
                    id="rulePriority"
                    integer
                    min="1"
                    placeholder="10"
                    value={newRule.priority}
                    onValueChange={(v) => setNewRule({ ...newRule, priority: v })}
                    className={`${inputClass} tabular-nums`}
                  />
                </div>
              </div>

              <div>
                <label htmlFor="ruleCategory" className={fieldLabel}>Category</label>
                <select
                  id="ruleCategory"
                  value={newRule.category_id}
                  onChange={(e) => setNewRule({ ...newRule, category_id: e.target.value })}
                  className={inputClass}
                >
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="rulePayeeOverride" className={fieldLabel}>Payee override (optional)</label>
                <input
                  id="rulePayeeOverride"
                  type="text"
                  placeholder="Netflix"
                  value={newRule.normalized_payee_override}
                  onChange={(e) =>
                    setNewRule({ ...newRule, normalized_payee_override: e.target.value })
                  }
                  className={inputClass}
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 px-6 pt-2 pb-6">

              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className={secondaryButton}
              >
                Cancel
              </button>
              <button type="submit" className={primaryButton}>
                Save rule
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
