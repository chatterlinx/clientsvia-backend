/**
 * ════════════════════════════════════════════════════════════════════════════
 * TRUTH EXPORT V1 — TYPESCRIPT SCHEMA DEFINITION
 * ClientVia Agent Console · Truth Contract Type Definitions
 * ════════════════════════════════════════════════════════════════════════════
 * 
 * PURPOSE:
 * This file provides complete TypeScript type definitions for the Truth Export
 * JSON contract. Use this for:
 * 
 * - Type-safe Truth JSON parsing
 * - Call 2.0 development (import these types)
 * - Frontend development (TypeScript projects)
 * - API documentation
 * - Schema validation
 * 
 * RULE:
 * "If it's not in UI, it does NOT exist."
 * 
 * The Truth contract enforces this rule by exposing violations in Lane D.
 * 
 * VERSION: 1.0.0
 * DATE: February 2026
 * CONTRACT: TruthExportV1
 * 
 * ════════════════════════════════════════════════════════════════════════════
 */

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ROOT TRUTH CONTRACT
 * ═══════════════════════════════════════════════════════════════════════════
 */
export interface TruthExportV1 {
  /** Truth contract version (semantic versioning) */
  truthVersion: "1.0.0";
  
  /** Overall truth status (COMPLETE if no critical issues) */
  truthStatus: "COMPLETE" | "INCOMPLETE";
  
  /** Timestamp when truth was exported (ISO 8601) */
  exportedAt: string;
  
  /** User who requested the export */
  exportedBy: string;
  
  /** Page from which export was triggered (Referer header) */
  exportedFromPage?: string;
  
  /** Lane A: UI Source Truth (what files are deployed) */
  uiSource: UISourceTruth;
  
  /** Lane B: Runtime Truth (what config will be used) */
  runtime: RuntimeTruth;
  
  /** Lane C: Build Truth (what build is running) */
  build: BuildTruth;
  
  /** Lane D: Compliance Truth (what violations exist) */
  compliance: ComplianceTruth;
  
  /** Aggregated status from all lanes */
  truthStatusDetails: TruthStatusDetails;
  
  /** Metadata about this truth contract */
  meta: TruthMetadata;
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * LANE A: UI SOURCE TRUTH
 * ═══════════════════════════════════════════════════════════════════════════
 */
export interface UISourceTruth {
  /** Total number of UI files discovered */
  totalFiles: number;
  
  /** Array of all UI file manifests */
  files: UIFile[];
  
  /** Page discovery results */
  pageDiscovery: PageDiscovery;
  
  /** Modal discovery results */
  modalDiscovery: ModalDiscovery;
  
  /** Internal link validation results */
  linkValidation: LinkValidation;
  
  /** When UI scan was performed */
  scannedAt: string;
  
  /** How long UI scan took */
  scanDuration: string;
  
  /** Whether base64 contents are included */
  includeContents: boolean;
}

export interface UIFile {
  /** Absolute path from web root */
  path: string; // "/agent-console/index.html"
  
  /** Relative path within agent-console directory */
  relativePath: string; // "index.html"
  
  /** File size in bytes */
  size: number;
  
  /** Last modification timestamp (ISO 8601) */
  lastModified: string;
  
  /** SHA-256 hash of file contents (hex) */
  sha256: string;
  
  /** Base64-encoded file contents (only if includeContents=1) */
  contentBase64: string | null;
  
  /** Error message if file could not be read */
  error?: string;
}

export interface PageDiscovery {
  /** Total HTML pages found */
  totalPages: number;
  
  /** Array of discovered pages */
  pages: Page[];
  
  /** Expected pages based on audit */
  expectedPages: string[];
  
  /** New pages not in expected list */
  newPagesDetected: Page[];
  
  /** Expected pages that are missing */
  missingPages: string[];
  
  /** Discovery status */
  status: "COMPLETE" | "NEW_PAGES_FOUND" | "PAGES_MISSING";
}

export interface Page {
  /** Page filename */
  filename: string; // "agent2.html"
  
  /** Full URL path */
  url: string; // "/agent-console/agent2.html"
  
  /** Expected JavaScript controller filename */
  jsController: string; // "agent2.js"
  
  /** Whether JS controller file exists */
  jsControllerExists: boolean;
}

export interface ModalDiscovery {
  /** Total modals found across all pages */
  totalModals: number;
  
  /** Array of discovered modals */
  modals: Modal[];
  
  /** Expected modal IDs based on audit */
  expectedModals: string[];
  
  /** New modals not in expected list */
  newModalsDetected: Modal[];
  
  /** Expected modals that are missing */
  missingModals: string[];
  
  /** Discovery status */
  status: "COMPLETE" | "NEW_MODALS_FOUND" | "MODALS_MISSING";
}

export interface Modal {
  /** Modal DOM ID */
  modalId: string; // "modal-greeting-rule"
  
  /** Page containing this modal */
  page: string; // "agent2.html"
  
  /** Full page URL */
  pageUrl: string; // "/agent-console/agent2.html"
}

export interface LinkValidation {
  /** Total broken links found */
  totalIssues: number;
  
  /** Array of broken link details */
  brokenLinks: BrokenLink[];
  
  /** Validation status */
  status: "VALID" | "BROKEN_LINKS_FOUND";
}

export interface BrokenLink {
  /** File containing the broken link */
  sourceFile: string;
  
  /** The missing link target (cleaned) */
  missingLink: string;
  
  /** Full link as it appears in source */
  fullLink: string;
  
  /** Issue severity */
  severity: "WARNING";
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * LANE B: RUNTIME TRUTH
 * ═══════════════════════════════════════════════════════════════════════════
 */
export interface RuntimeTruth {
  /** Effective configuration for this company */
  effectiveConfig: EffectiveConfig;
  
  /** SHA-256 hash of canonical JSON (deterministic) */
  effectiveConfigHash: string;
  
  /** Config version (company.updatedAt timestamp) */
  effectiveConfigVersion: string | null;
  
  /** When runtime snapshot was captured */
  capturedAt: string;
  
  /** How long runtime extraction took */
  buildDuration: string;
}

export interface EffectiveConfig {
  companyId: string;
  companyName: string;
  agent2: Agent2Config;
  booking: BookingConfig;
  voice: VoiceConfig;
  llmControls: LLMControls;
  calendar: CalendarConfig;
  twilio: TwilioConfig;
}

export interface Agent2Config {
  greetings: {
    callStart: CallStartGreeting;
    interceptor: GreetingInterceptor;
    returnCaller: ReturnCallerGreeting;
  };
  triggers: {
    activeGroupId: string | null;
    localTriggers: Trigger[];
    localTriggersCount: number;
  };
  discovery: DiscoverySettings;
  consentPhrases: string[];
  escalationPhrases: string[];
  bookingPrompts: BookingPrompts;
}

export interface CallStartGreeting {
  enabled: boolean;
  text: string;
  audioUrl: string | null;
  audioTextHash?: string;
  audioGeneratedAt?: string;
  emergencyFallback?: string;
}

export interface GreetingInterceptor {
  enabled: boolean;
  shortOnlyGate: {
    maxWords: number;
    blockIfIntentWords: boolean;
  };
  intentWords: string[];
  rules: GreetingRule[];
}

export interface GreetingRule {
  ruleId: string;
  enabled: boolean;
  priority: number;
  matchType: "EXACT" | "FUZZY" | "CONTAINS" | "REGEX";
  triggers: string[];
  response: string;
  audioUrl: string | null;
  audioTextHash?: string;
  audioGeneratedAt?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface ReturnCallerGreeting {
  enabled?: boolean;
  text?: string;
}

export interface DiscoverySettings {
  style?: {
    ackWord?: string;
    robotChallenge?: {
      enabled?: boolean;
      line?: string;
    };
  };
  holdMessage?: string;
  vocabulary?: string[];
}

export interface BookingPrompts {
  askName?: string;
  askNameRetry?: string;
  askPhone?: string;
  askPhoneRetry?: string;
  askAddress?: string;
  askAddressRetry?: string;
  noAvailableTimes?: string;
  timePreferenceRetry?: string;
  appointmentConfirmed?: string;
}

export interface Trigger {
  triggerId: string;
  ruleId: string;
  label: string;
  priority: number;
  scope: "GLOBAL" | "LOCAL";
  enabled: boolean;
  match?: {
    keywords?: string[];
    phrases?: string[];
    negativeKeywords?: string[];
  };
  answer?: {
    answerText?: string;
    audioUrl?: string;
    hasAudio?: boolean;
    audioNeedsRegeneration?: boolean;
  };
  llmFactPack?: {
    includedFacts?: string;
    excludedFacts?: string;
    backupAnswer?: string;
  };
  responseMode?: "standard" | "llm";
  followUp?: {
    question?: string;
    nextAction?: string;
  };
}

export interface BookingConfig {
  slotDuration: number;
  bufferMinutes: number;
  advanceBookingDays: number;
  confirmationMessage: string;
  enableSmsConfirmation: boolean;
}

export interface VoiceConfig {
  provider: string; // "elevenlabs"
  voiceId: string | null;
  model: string | null;
  stability: number | null;
  similarity_boost: number | null;
}

export interface LLMControls {
  recoveryMessages: RecoveryMessages;
  llmFallback: object;
}

export interface RecoveryMessages {
  audioUnclear?: string[];
  connectionCutOut?: string[];
  silenceRecovery?: string[];
  generalError?: string[];
  technicalTransfer?: string[];
}

export interface CalendarConfig {
  connected: boolean;
  calendarId: string | null;
  connectedAt: string | null;
}

export interface TwilioConfig {
  configured: boolean;
  accountStatus: string;
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * LANE C: BUILD TRUTH
 * ═══════════════════════════════════════════════════════════════════════════
 */
export interface BuildTruth {
  /** Git commit hash */
  gitCommit: string;
  
  /** Build timestamp */
  buildTime: string;
  
  /** Server version from package.json */
  serverVersion: string;
  
  /** Runtime environment */
  environment: "production" | "staging" | "development";
  
  /** Node.js version */
  nodeVersion: string;
  
  /** Operating system platform */
  platform: string;
  
  /** Deployment ID (Render/Vercel) */
  deploymentId: string;
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * LANE D: COMPLIANCE TRUTH
 * ═══════════════════════════════════════════════════════════════════════════
 */
export interface ComplianceTruth {
  /** UI coverage report (components without UI editors) */
  uiCoverageReport: UICoverageReport;
  
  /** Hardcoded speech scan results */
  hardcodedSpeechScan: HardcodedSpeechScan;
  
  /** When compliance scan was performed */
  scannedAt: string;
  
  /** How long compliance scan took */
  scanDuration: string;
}

export interface UICoverageReport {
  /** Total components that should be UI-driven */
  totalComponents: number;
  
  /** Number of compliant components */
  compliantComponents: number;
  
  /** Number of components missing UI */
  totalIssues: number;
  
  /** Array of UI coverage issues */
  issues: UIIssue[];
  
  /** Compliance percentage (0-100) */
  compliantPercentage: number;
  
  /** Overall status */
  status: "COMPLIANT" | "VIOLATIONS_FOUND";
}

export interface UIIssue {
  /** Component name */
  component: string; // "bookingPrompts"
  
  /** Issue severity */
  severity: "CRITICAL" | "HIGH" | "MEDIUM";
  
  /** Issue description */
  issue: string;
  
  /** Current UI path (or MISSING) */
  uiPath: "MISSING" | string;
  
  /** Where UI should be added */
  expectedUiLocation: string;
  
  /** Backend file with hardcoded fallback */
  backendFile: string;
  
  /** Business impact description */
  impact: string;
}

export interface HardcodedSpeechScan {
  /** Scan completion status */
  scanStatus: "SUCCESS" | "ERROR";
  
  /** Error message if scan failed */
  error?: string;
  
  /** When scan was performed */
  scannedAt: string;
  
  /** Scan execution time */
  duration: string;
  
  /** Number of files scanned */
  scannedFiles: number;
  
  /** Number of lines scanned */
  scannedLines: number;
  
  /** Directories that were scanned */
  scannedDirs: string[];
  
  /** Violation details */
  violations: {
    /** Total violations found */
    total: number;
    
    /** Critical severity count */
    critical: number;
    
    /** High severity count */
    high: number;
    
    /** Medium severity count */
    medium: number;
    
    /** Array of violation details */
    list: CodeViolation[];
    
    /** Whether results were capped */
    capped: boolean;
    
    /** Cap notice if results were limited */
    capNote: string | null;
  };
  
  /** Summary assessment */
  summary: {
    /** Overall status */
    status: "CLEAN" | "VIOLATIONS_FOUND";
    
    /** Human-readable message */
    message: string;
    
    /** Recommended action */
    recommendation: string;
  };
}

export interface CodeViolation {
  /** File containing violation */
  file: string; // "services/engine/booking/BookingLogicEngine.js"
  
  /** Line number (1-indexed) */
  line: number;
  
  /** Code snippet (truncated) */
  code: string;
  
  /** Pattern that matched */
  pattern: string; // "RESPONSE_TEXT_ASSIGNMENT"
  
  /** Violation severity */
  severity: "CRITICAL" | "HIGH" | "MEDIUM";
  
  /** Violation description */
  description: string;
  
  /** Rule being violated */
  rule: "All agent speech must be UI-driven";
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * AGGREGATED TRUTH STATUS
 * ═══════════════════════════════════════════════════════════════════════════
 */
export interface TruthStatusDetails {
  /** Overall status (COMPLETE if no critical issues) */
  status: "COMPLETE" | "INCOMPLETE";
  
  /** Total issues across all lanes */
  totalIssues: number;
  
  /** Number of critical issues */
  criticalIssues: number;
  
  /** Array of all issues */
  issues: Issue[];
  
  /** Overall compliance percentage */
  compliantPercentage: number;
}

export interface Issue {
  /** Issue type identifier */
  type: string; // "UI_COVERAGE_VIOLATIONS", "NEW_PAGES_DETECTED", etc.
  
  /** Issue severity */
  severity: "CRITICAL" | "WARNING" | "INFO";
  
  /** Human-readable message */
  message: string;
  
  /** Recommended action */
  action: string;
  
  /** Type-specific additional data */
  [key: string]: any;
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * METADATA
 * ═══════════════════════════════════════════════════════════════════════════
 */
export interface TruthMetadata {
  /** Contract description */
  note: string;
  
  /** Core rule being enforced */
  rule: string;
  
  /** Purpose description */
  purpose: string;
  
  /** Usage examples */
  usage: string[];
  
  /** Contract version identifier */
  contractVersion: "TruthExportV1";
  
  /** Documentation location */
  documentation: string;
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * UTILITY TYPES
 * ═══════════════════════════════════════════════════════════════════════════
 */

/** Severity levels for issues and violations */
export type Severity = "CRITICAL" | "HIGH" | "MEDIUM" | "WARNING" | "INFO";

/** Truth status (COMPLETE or INCOMPLETE with reasons) */
export type TruthStatus = "COMPLETE" | "INCOMPLETE";

/** Component scopes */
export type Scope = "GLOBAL" | "LOCAL";

/** Match types for greeting/trigger rules */
export type MatchType = "EXACT" | "FUZZY" | "CONTAINS" | "REGEX";

/** Response modes for triggers */
export type ResponseMode = "standard" | "llm";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * USAGE EXAMPLES (TypeScript)
 * ═══════════════════════════════════════════════════════════════════════════
 */

/**
 * Example 1: Parse Truth JSON in TypeScript
 */
export function parseTruthJson(jsonString: string): TruthExportV1 {
  const truth: TruthExportV1 = JSON.parse(jsonString);
  
  // Type-safe access
  console.log('Truth Version:', truth.truthVersion);
  console.log('Status:', truth.truthStatus);
  console.log('UI Files:', truth.uiSource.totalFiles);
  console.log('Compliance:', `${truth.compliance.uiCoverageReport.compliantPercentage}%`);
  
  return truth;
}

/**
 * Example 2: Validate Truth Status
 */
export function validateTruthStatus(truth: TruthExportV1): boolean {
  if (truth.truthStatus === 'INCOMPLETE') {
    console.error('Truth contract is INCOMPLETE');
    
    truth.truthStatusDetails.issues.forEach(issue => {
      console.error(`[${issue.severity}] ${issue.type}: ${issue.message}`);
      console.error(`  Action: ${issue.action}`);
    });
    
    return false;
  }
  
  return true;
}

/**
 * Example 3: Extract UI Files
 */
export function getUIFileByPath(truth: TruthExportV1, path: string): UIFile | undefined {
  return truth.uiSource.files.find(f => f.path === path);
}

/**
 * Example 4: Check Compliance
 */
export function getCompliancePercentage(truth: TruthExportV1): number {
  return truth.compliance.uiCoverageReport.compliantPercentage;
}

/**
 * Example 5: Get Critical Violations
 */
export function getCriticalViolations(truth: TruthExportV1): UIIssue[] {
  return truth.compliance.uiCoverageReport.issues.filter(
    issue => issue.severity === 'CRITICAL'
  );
}

/**
 * Example 6: Verify Config Hash
 */
export function verifyConfigHash(truth: TruthExportV1, expectedHash: string): boolean {
  return truth.runtime.effectiveConfigHash === expectedHash;
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * JSON SCHEMA (for validation libraries)
 * ═══════════════════════════════════════════════════════════════════════════
 */

export const TruthExportV1Schema = {
  $schema: "http://json-schema.org/draft-07/schema#",
  title: "TruthExportV1",
  type: "object",
  required: ["truthVersion", "truthStatus", "exportedAt", "uiSource", "runtime", "build", "compliance"],
  properties: {
    truthVersion: { type: "string", const: "1.0.0" },
    truthStatus: { type: "string", enum: ["COMPLETE", "INCOMPLETE"] },
    exportedAt: { type: "string", format: "date-time" },
    exportedBy: { type: "string" },
    uiSource: { type: "object" },
    runtime: { type: "object" },
    build: { type: "object" },
    compliance: { type: "object" },
    truthStatusDetails: { type: "object" },
    meta: { type: "object" }
  }
};

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * END OF TYPE DEFINITIONS
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * NOTES:
 * - All timestamps are ISO 8601 format
 * - All hashes are lowercase hex strings
 * - All file paths use forward slashes (even on Windows)
 * - Optional fields use TypeScript's ? modifier
 * - Arrays may be empty but are never null/undefined
 * 
 * VERSIONING:
 * - Contract version: "TruthExportV1"
 * - Schema version: 1.0.0
 * - Breaking changes require new contract version (TruthExportV2)
 * 
 * ═══════════════════════════════════════════════════════════════════════════
 */
