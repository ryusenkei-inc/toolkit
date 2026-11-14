variable "zone_id" {
  type        = string
  description = "プロダクトの独自ドメインのゾーンの ID"
}

variable "domain" {
  type        = string
  description = "apex のドメイン（例: example.com）"
}

variable "strip_trailing_slash" {
  type        = bool
  description = "末尾のスラッシュを外す 301 も足す（`/` は残す。www からの転送も1回で外す）"
  default     = false
}

variable "trailing_slash_exclude" {
  type        = list(string)
  description = "末尾のスラッシュを外さないパスの接頭辞（例: `/manage/`。`strip_trailing_slash` のときだけ）"
  default     = []
}
