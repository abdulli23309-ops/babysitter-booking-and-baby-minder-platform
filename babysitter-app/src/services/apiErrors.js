// Error normalization helpers - Phase F1
export const ERROR_TYPES = {
  NETWORK_ERROR: 'NETWORK_ERROR',
  SERVER_ERROR: 'SERVER_ERROR',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  UNAUTHORIZED: 'UNAUTHORIZED',
  UNKNOWN_ERROR: 'UNKNOWN_ERROR',
};

export function normalizeApiError(error) {
  if (!error) {
    return {
      message: 'An unknown error occurred.',
      status: null,
      type: ERROR_TYPES.UNKNOWN_ERROR,
      originalError: null,
    };
  }

  const status = error.response?.status || null;
  let type = ERROR_TYPES.UNKNOWN_ERROR;
  let message = error.message || 'An error occurred';

  if (!error.response) {
    type = ERROR_TYPES.NETWORK_ERROR;
    message = 'Network error. Please check your connection.';
  } else if (status === 401 || status === 403) {
    type = ERROR_TYPES.UNAUTHORIZED;
    message = 'Session expired or unauthorized. Please log in again.';
  } else if (status === 400 || status === 422) {
    type = ERROR_TYPES.VALIDATION_ERROR;
        message = typeof error.response.data === 'string'
      ? error.response.data
      : error.response.data?.message || error.response.data?.Message || 'Invalid request.';
  } else if (status >= 500) {
    type = ERROR_TYPES.SERVER_ERROR;
    message = 'Internal server error. Please try again later.';
  } else if (error.response.data?.message) {
    message = error.response.data.message;
  } else if (error.response.data?.message || error.response.data?.Message) {
    message = error.response.data.message || error.response.data.Message;
  }

  return {
    message,
    status,
    type,
    originalError: error,
  };
}

export function normalizeFetchError(error, response) {
  const status = response?.status || null;
  let type = ERROR_TYPES.UNKNOWN_ERROR;
  let message = error?.message || 'An error occurred';

  if (!response) {
    type = ERROR_TYPES.NETWORK_ERROR;
    message = 'Network error. Please check your connection.';
  } else if (status === 401 || status === 403) {
    type = ERROR_TYPES.UNAUTHORIZED;
    message = 'Session expired or unauthorized.';
  } else if (status >= 500) {
    type = ERROR_TYPES.SERVER_ERROR;
    message = 'Server error occurred.';
  }

  return { message, status, type, originalError: error };
}

