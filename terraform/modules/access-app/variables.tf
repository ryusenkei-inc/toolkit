variable "account_id" {
  type        = string
  description = "Cloudflare のアカウントの ID"
}

variable "name" {
  type        = string
  description = "アプリの名前（ダッシュボードの表示）"
}

variable "domain" {
  type        = string
  description = "保護するホスト名（パスを含めてもよい）。公開の前のサイト全体を保護するなら、サイトのホスト名"
}

variable "allowed_emails" {
  type        = list(string)
  description = "入れるメールアドレス"
}

variable "bypass_paths" {
  type        = list(string)
  description = "Access を通さないパス（例: /healthz）。先頭は /"
  default     = []

  validation {
    condition     = alltrue([for p in var.bypass_paths : startswith(p, "/")])
    error_message = "bypass_paths は / で始める"
  }
}

variable "session_duration" {
  type        = string
  description = "ログインの有効期間"
  default     = "24h"
}
