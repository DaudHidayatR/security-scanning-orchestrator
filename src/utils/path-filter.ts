/**
 * File path filtering utilities.
 * Determines whether a file should be scanned based on path and extension.
 */

/** Directories and file extensions that are always skipped. */
const SKIP_DIRS = /^(node_modules|vendor|dist|build|\.git)\//;

const SKIP_EXTS = /\.(lock|json|yaml|yml|toml|md|txt|svg|png|jpg|jpeg|gif|ico|woff|woff2|ttf|eot)$/i;

/**
 * Returns true if the filename should be skipped (binary, vendor, lock files, etc.).
 */
export function shouldSkipFile(filename: string): boolean {
  return SKIP_DIRS.test(filename) || SKIP_EXTS.test(filename);
}

/**
 * Returns true if the filename represents a scannable source file.
 * This is the inverse of `shouldSkipFile`.
 */
export function isScannableFile(filename: string): boolean {
  return !shouldSkipFile(filename);
}
