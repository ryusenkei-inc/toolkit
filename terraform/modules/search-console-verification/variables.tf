variable "zone_id" {
  type        = string
  description = "ゾーンの ID"
}

variable "domain" {
  type        = string
  description = "確認するドメイン（例: example.com、ゾーンの中のサブドメインも可）"
}

variable "tokens" {
  type        = list(string)
  description = "確認の値（`google-site-verification=...`、前置きは省略可）。確認する人やサービスアカウントごとに1つ"
}
