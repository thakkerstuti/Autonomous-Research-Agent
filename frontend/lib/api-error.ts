export class ApiError extends Error {
  status: number;
  data: any;

  constructor(status: number, message: string, data?: any) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.data = data;
  }
}

export async function errorFromResponse(response: Response): Promise<ApiError> {
  let detail = "An unexpected error occurred";
  let data: any;
  try {
    data = await response.json();
    if (typeof data?.detail === "string") detail = data.detail;
  } catch {
    // response might not be JSON
  }
  return new ApiError(response.status, detail, data);
}
