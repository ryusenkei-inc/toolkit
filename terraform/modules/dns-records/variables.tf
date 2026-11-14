variable "zone_id" {
  type        = string
  description = "ゾーンの ID"
}

variable "records" {
  description = "DNS のレコード。`key` のないレコードは、内容を変えると作り直す（キーが内容のハッシュのため）。内容を変えても同じレコードとして更新するには `key` を付ける"
  type = list(object({
    key      = optional(string) # state のキー。付けると内容を変えても作り直さない（既存のレコードに付けるときは moved で今のキーから移す）
    name     = string
    type     = string
    content  = string
    ttl      = optional(number, 1) # 1 は自動
    priority = optional(number)
    proxied  = optional(bool, false)
    comment  = optional(string)
  }))
  default = []
}
