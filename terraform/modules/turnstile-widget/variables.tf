variable "account_id" {
  type        = string
  description = "Cloudflare のアカウントの ID"
}

variable "name" {
  type        = string
  description = "widget の名前（ダッシュボードの表示）"
}

variable "domains" {
  type        = list(string)
  description = "widget を置くページのホスト名。サーバー側の検証でも、トークンを発行したホスト名をこの一覧と照合する"
}

variable "mode" {
  type        = string
  description = "managed（必要なときだけ操作を求める）、non-interactive、invisible"
  default     = "managed"

  validation {
    condition     = contains(["managed", "non-interactive", "invisible"], var.mode)
    error_message = "mode は managed、non-interactive、invisible のどれか"
  }
}
