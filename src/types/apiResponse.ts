export interface Pagination {
  page: number;
  pageSize: number;
  totalPage: number;
  totalRecord: number;
}

export interface ApiResponse<T = any> {
  responseStatus: "success" | "error";
  message: string;
  data: T;
  pagination?: Pagination;
}
