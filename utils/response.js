"use strict";

// ============================================================
// RESPONSE HELPERS
// All Cloud Function responses use these two functions.
// Never let raw errors or unhandled exceptions reach the client.
// ============================================================

/**
 * Return a successful response.
 * @param {object} res       - Express-style response object
 * @param {object} data      - Payload to return
 * @param {number} [status]  - HTTP status code (default 200)
 */
function successResponse(res, data, status = 200) {
  return res.status(status).json({
    success: true,
    timestamp: new Date().toISOString(),
    ...data,
  });
}

/**
 * Return an error response.
 * Always returns a structured error — never exposes stack traces.
 * @param {object} res        - Express-style response object
 * @param {string} errorCode  - One of ERROR_CODES constants
 * @param {string} message    - Human-readable message (Vietnamese OK)
 * @param {number} [status]   - HTTP status code (default mapped from code)
 */
function errorResponse(res, errorCode, message, status) {
  const httpStatus = status || _mapCodeToStatus(errorCode);
  return res.status(httpStatus).json({
    success: false,
    error_code: errorCode,
    message,
    timestamp: new Date().toISOString(),
  });
}

/**
 * Wrap an async handler to catch all unhandled errors.
 * All handlers must be wrapped with this — no try/catch needed inside
 * unless the handler wants to handle specific errors differently.
 *
 * Usage in index.js:
 *   app.post("/login", asyncHandler(authHandler.login));
 *
 * @param {Function} fn - async (req, res) => void
 * @returns {Function}
 */
function asyncHandler(fn) {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (err) {
      // Known app errors have a `code` field (from checkPermission, etc.)
      if (err.code && typeof err.code === "string" && err.message) {
        const httpStatus = _mapCodeToStatus(err.code);
        return res.status(httpStatus).json({
          success: false,
          error_code: err.code,
          message: err.message,
          timestamp: new Date().toISOString(),
        });
      }

      // Unknown / unexpected errors — log and return generic message
      console.error("[SYS_001]", err);
      return res.status(500).json({
        success: false,
        error_code: "SYS_001",
        message: "Lỗi hệ thống. Vui lòng thử lại sau.",
        timestamp: new Date().toISOString(),
      });
    }
  };
}

// ============================================================
// INTERNAL: map error code prefix → HTTP status
// ============================================================
function _mapCodeToStatus(code) {
  if (!code) return 500;
  if (code.startsWith("AUTH")) return 401;
  if (code.startsWith("PERM")) return 403;
  if (code.startsWith("DATA")) return 400;
  if (code.startsWith("SYNC")) return 200; // warnings, not errors
  return 500;
}

module.exports = { successResponse, errorResponse, asyncHandler };
