// Browser helpers only. Chain decisions and transaction plans come from B over HTTP.
export { DEFAULT_POLICY, STATUS, validateDurations, validatePublicSetup, parseSwapTerms, requireBytes32,
  expectedLock, fieldMismatches, assertFields, safeErrorMessage } from "../../shared/swapInputs.mjs";

// B classifies the record at its snapshot block; C only displays the result.
export function recoveryView(record) { return record.recovery; }
