#!/usr/bin/env ruby
require "yaml"

manifest = YAML.safe_load_file(File.expand_path("../integrations/alfe/alfe-integration.yaml", __dir__))
provider = manifest.fetch("installs").fetch("runtimes").fetch("openclaw").fetch("config")
  .fetch("models").fetch("providers").fetch("openai")
raise "Bedrock models must use the Alfe loopback proxy" unless provider.fetch("baseUrl") == "http://127.0.0.1:18193/v1"
raise "Bedrock models must use chat completions" unless provider.fetch("api") == "openai-completions"
models = provider.fetch("models")
ids = ["openai.gpt-oss-120b-1:0", "openai.gpt-oss-20b-1:0", "qwen.qwen3-coder-30b-a3b-v1:0",
  "zai.glm-5", "moonshotai.kimi-k2.5", "deepseek.v3.2"]
raise "Unexpected AWS-hosted alias" unless models.count { |model| model.fetch("id").start_with?("alfe-bedrock-") } == ids.length
ids.each do |id|
  native = models.select { |model| model.fetch("id") == id }
  public_alias = models.select { |model| model.fetch("id") == "alfe-bedrock-#{id}" }
  raise "Missing or duplicate identity for #{id}" unless native.length == 1 && public_alias.length == 1
  capabilities = ->(model) { model.reject { |key, _| ["id", "name"].include?(key) } }
  raise "Native and alias capabilities differ for #{id}" unless capabilities.call(native.first) == capabilities.call(public_alias.first)
  raise "Alias must disclose Fly connection for #{id}" unless public_alias.first.fetch("name").include?("Fly-connected")
  raise "Unsafe response budget for #{id}" unless public_alias.first.fetch("maxTokens") <= 16384
  raise "Only text input is supported for #{id}" unless public_alias.first.fetch("input") == ["text"]
  %w[supportsStore supportsDeveloperRole supportsStrictMode supportsPromptCacheKey].each do |key|
    raise "Unsafe #{key} for #{id}" unless public_alias.first.fetch("compat").fetch(key) == false
  end
end
puts "Six AWS-hosted aliases preserve the strict catalogue and safe runtime capabilities."
