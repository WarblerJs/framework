/** Normalized JSON body policy. */
export interface JsonBodyPolicy {
  readonly enabled: boolean;
  readonly maxSize: number;
  readonly maxDepth: number;
  readonly maxKeys: number;
}

/** Normalized text body policy. */
export interface TextBodyPolicy {
  readonly enabled: boolean;
  readonly maxSize: number;
}

/** Normalized URL-encoded body policy. */
export interface UrlEncodedBodyPolicy extends TextBodyPolicy {
  readonly maxFields: number;
  readonly maxFieldSize: number;
}

/** Normalized multipart body policy. */
export interface MultipartBodyPolicy extends TextBodyPolicy {
  readonly maxFiles: number;
  readonly maxFileSize: number;
  readonly maxFields: number;
  readonly maxFieldSize: number;
  readonly allowedMimeTypes: readonly string[];
}

/** Normalized request body policy. */
export interface BodyPolicy {
  readonly enabled: boolean;
  readonly maxSize: number;
  readonly json: JsonBodyPolicy;
  readonly text: TextBodyPolicy;
  readonly urlEncoded: UrlEncodedBodyPolicy;
  readonly multipart: MultipartBodyPolicy;
  readonly unknownContentType: "reject" | "ignore";
}
