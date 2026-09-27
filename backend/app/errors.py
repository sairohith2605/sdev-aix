from fastapi.responses import JSONResponse


class ApiError(Exception):
    def __init__(self, message: str, status_code: int = 502, code: str = "ADO_ERROR"):
        super().__init__(message)
        self.message = message
        self.status_code = status_code
        self.code = code


class ConnectorError(ApiError):
    pass


class PlanError(ApiError):
    pass


class RepositoryError(ApiError):
    pass


def raise_http_error(error: ApiError) -> JSONResponse:
    return JSONResponse(
        status_code=error.status_code,
        content={
            "message": error.message,
            "code": error.code,
            "status": error.status_code,
        },
    )
