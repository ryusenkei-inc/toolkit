variable "zone_id" {
  type        = string
  description = "ゾーンの ID"
}

variable "records" {
  description = "DNS のレコード。内容を変えたレコードは作り直す（キーが内容のハッシュのため）"
  type = list(object({
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
