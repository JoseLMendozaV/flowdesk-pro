use thiserror::Error;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("Error de base de datos: {0}")]
    Database(#[from] rusqlite::Error),
    #[error("Error del sistema de archivos: {0}")]
    Io(#[from] std::io::Error),
    #[error("No se pudo generar el archivo Excel: {0}")]
    Excel(#[from] rust_xlsxwriter::XlsxError),
    #[error("No se pudo leer el archivo de estudiantes: {0}")]
    ExcelImport(#[from] calamine::Error),
    #[error("{0}")]
    Validation(String),
    #[error("No se pudo acceder al estado interno de la aplicación")]
    State,
}

impl serde::Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

impl From<String> for AppError {
    fn from(message: String) -> Self {
        Self::Validation(message)
    }
}

pub type AppResult<T> = Result<T, AppError>;
