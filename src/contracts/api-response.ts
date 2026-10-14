export interface ApiMeta {
  requestId: string;
}

export interface ApiSuccess<T> {
  data: T;
  meta: ApiMeta;
}

export interface ApiFailure {
  error: {
    code: string;
    message: string;
    requestId: string;
  };
}
