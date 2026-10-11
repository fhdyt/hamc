import type { QueryError } from '@shared/ipc'

const TEXT: Record<QueryError, string> = {
  bad_args: 'The server refused this request.',
  not_found: 'This folder does not exist on the server.',
  unsupported_schema: 'This server uses a database layout Mission Control does not know.',
  db_unreadable: 'A database on the server could not be read.',
  unreadable: 'This folder cannot be read by your SSH user.',
  unknown_command: 'The server did not understand the request.',
  timeout: 'The server took too long to answer.',
  'not-connected': 'Not connected to the server.',
  'invalid-response': 'The server gave an answer Mission Control could not read.'
}

/** A message for a failed query, with the technical reason in brackets so it can be reported. */
export function describeQueryError(error: QueryError, detail?: string): string {
  const base = TEXT[error]
  return error === 'invalid-response' && detail ? `${base} (${detail})` : base
}
