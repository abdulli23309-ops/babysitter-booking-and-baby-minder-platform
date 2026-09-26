namespace WebApplication2.DTOs
{
    public class ImageFileResult
    {
        public bool IsValid { get; set; }
        public bool Exists { get; set; }
        public string FilePath { get; set; }
        public string MimeType { get; set; }
    }
}
