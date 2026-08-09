package main

import (
	"bytes"
	"encoding/json"
	"strings"
	"testing"
)

func TestRunCompressesToolResultsAndPreservesEnvelope(t *testing.T) {
	toolOutput := strings.Repeat("progress\r", 20) + "\nFAIL: TestCritical\n"
	payload := request{
		Version: protocolVersion,
		Messages: []map[string]any{
			{"role": "user", "content": "keep my request", "name": "caller"},
			{"role": "tool", "content": toolOutput, "tool_call_id": "call-1"},
		},
		ToolResultLimit: 256,
	}
	encoded, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}

	var output bytes.Buffer
	if err := run(bytes.NewReader(encoded), &output); err != nil {
		t.Fatal(err)
	}

	var got response
	if err := json.Unmarshal(output.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got.Version != protocolVersion || len(got.Messages) != 2 {
		t.Fatalf("unexpected response envelope: %+v", got)
	}
	if got.Messages[0]["content"] != "keep my request" || got.Messages[0]["name"] != "caller" {
		t.Fatalf("user message changed: %+v", got.Messages[0])
	}
	compressed, _ := got.Messages[1]["content"].(string)
	if !strings.Contains(compressed, "FAIL: TestCritical") {
		t.Fatalf("protected finding was lost: %q", compressed)
	}
	if got.Messages[1]["tool_call_id"] != "call-1" {
		t.Fatalf("tool envelope changed: %+v", got.Messages[1])
	}
	if got.Report.SavedBytes <= 0 || got.Report.OriginalBytes-len("keep my request") <= len(compressed) {
		t.Fatalf("compression report is not useful: %+v", got.Report)
	}
}

func TestRunRejectsUnknownProtocolVersion(t *testing.T) {
	err := run(strings.NewReader(`{"version":2,"messages":[],"toolResultLimit":4096}`), &bytes.Buffer{})
	if err == nil || !strings.Contains(err.Error(), "unsupported protocol version") {
		t.Fatalf("expected version error, got %v", err)
	}
}
