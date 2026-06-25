/**
 * Re-exports from @amaze/pi-ai.
 * All credential storage types and the AuthStorage class now live in the ai package.
 */

export type {
	ApiKeyCredential,
	AuthCredential,
	AuthCredentialEntry,
	AuthCredentialStore,
	AuthStorageData,
	AuthStorageOptions,
	CredentialOrigin,
	CredentialOriginKind,
	OAuthAccountIdentity,
	OAuthCredential,
	ResetCreditAccountStatus,
	ResetCreditRedeemOutcome,
	ResetCreditTarget,
	SerializedAuthStorage,
	StoredAuthCredential,
} from "@amaze/pi-ai";
export { AuthStorage, REMOTE_REFRESH_SENTINEL, SqliteAuthCredentialStore } from "@amaze/pi-ai";
export type { SnapshotResponse } from "@amaze/pi-ai/auth-broker/types";
