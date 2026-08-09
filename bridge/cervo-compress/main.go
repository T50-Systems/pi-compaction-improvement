package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"

	compress "github.com/cervantesh/cervo-compress"
)

const protocolVersion = 1

type request struct {
	Version         int              `json:"version"`
	Messages        []map[string]any `json:"messages"`
	ToolResultLimit int              `json:"toolResultLimit"`
}

type response struct {
	Version  int              `json:"version"`
	Messages []map[string]any `json:"messages"`
	Report   report           `json:"report"`
}

type report struct {
	OriginalBytes int                     `json:"originalBytes"`
	SavedBytes    int                     `json:"savedBytes"`
	Engines       []string                `json:"engines"`
	ByEngine      []compress.EngineSaving `json:"byEngine"`
}

func main() {
	if err := run(os.Stdin, os.Stdout); err != nil {
		fmt.Fprintln(os.Stderr, "cervo-compress bridge:", err)
		os.Exit(1)
	}
}

func run(input io.Reader, output io.Writer) error {
	decoder := json.NewDecoder(input)
	decoder.DisallowUnknownFields()
	var envelope request
	if err := decoder.Decode(&envelope); err != nil {
		return fmt.Errorf("decode request: %w", err)
	}
	if envelope.Version != protocolVersion {
		return fmt.Errorf("unsupported protocol version %d", envelope.Version)
	}
	if envelope.ToolResultLimit < 256 {
		return errors.New("toolResultLimit must be at least 256 bytes")
	}

	messages, err := decodeMessages(envelope.Messages)
	if err != nil {
		return err
	}
	compressed, result := compress.Pipeline(
		messages,
		compress.Recommended(envelope.ToolResultLimit)...,
	)
	engines := append([]string{}, result.Engines...)
	byEngine := append([]compress.EngineSaving{}, result.ByEngine...)

	return json.NewEncoder(output).Encode(response{
		Version:  protocolVersion,
		Messages: encodeMessages(envelope.Messages, compressed),
		Report: report{
			OriginalBytes: result.OriginalBytes,
			SavedBytes:    result.SavedBytes,
			Engines:       engines,
			ByEngine:      byEngine,
		},
	})
}

func decodeMessages(raw []map[string]any) ([]compress.Message, error) {
	messages := make([]compress.Message, len(raw))
	for index, wire := range raw {
		role, ok := wire["role"].(string)
		if !ok {
			return nil, fmt.Errorf("message %d has no string role", index)
		}
		content, ok := wire["content"]
		if !ok {
			return nil, fmt.Errorf("message %d has no content", index)
		}
		extra := make(map[string]any, len(wire)-2)
		for key, value := range wire {
			if key != "role" && key != "content" {
				extra[key] = value
			}
		}
		messages[index] = compress.Message{Role: role, Content: content, Extra: extra}
	}
	return messages, nil
}

func encodeMessages(raw []map[string]any, messages []compress.Message) []map[string]any {
	out := make([]map[string]any, len(messages))
	for index, message := range messages {
		wire := make(map[string]any, len(raw[index]))
		for key, value := range raw[index] {
			wire[key] = value
		}
		wire["role"] = message.Role
		wire["content"] = message.Content
		out[index] = wire
	}
	return out
}
