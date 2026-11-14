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

variable "extra_rules" {
  description = "同じ ruleset に足す転送の規則（この phase の ruleset はゾーンに1つだけのため）。www と末尾のスラッシュの規則の後に並ぶ。転送先は target_expression（式）か target_url（固定の URL）"
  type = list(object({
    description           = string
    expression            = string
    target_expression     = optional(string)
    target_url            = optional(string)
    status_code           = optional(number, 301)
    preserve_query_string = optional(bool, true)
  }))
  default = []

  validation {
    condition     = alltrue([for r in var.extra_rules : (r.target_expression == null) != (r.target_url == null)])
    error_message = "extra_rules の各規則には target_expression か target_url のどちらか1つを書く"
  }
}

variable "ruleset_name" {
  type        = string
  description = "ruleset の名前（既定は「<domain> の www の転送」。既存の ruleset を取り込むときに今の名前を渡すと、作り直さない）"
  default     = null
}
