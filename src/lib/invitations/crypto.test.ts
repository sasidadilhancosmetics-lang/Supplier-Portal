import { describe, expect, it } from "vitest";

import {
  generateInviteToken,
  hashInviteToken,
  inviteTokensEqual,
  normalizeEmail,
} from "./crypto";
import { emailsMatchForInvite, invitationEffectiveStatus } from "./rules";
import { isSafeInviteReturnTo, buildInviteAcceptPath } from "./redirects";

describe("invite crypto", () => {
  it("hashes tokens consistently and compares safely", () => {
    const token = generateInviteToken();
    const hash = hashInviteToken(token);
    expect(hash).toHaveLength(64);
    expect(inviteTokensEqual(hash, hashInviteToken(token))).toBe(true);
    expect(inviteTokensEqual(hash, hashInviteToken(`${token}x`))).toBe(false);
  });

  it("normalizes emails", () => {
    expect(normalizeEmail("  Ada@Example.COM ")).toBe("ada@example.com");
  });
});

describe("invite rules", () => {
  it("marks pending invites expired after expiresAt", () => {
    expect(
      invitationEffectiveStatus({
        status: "PENDING",
        expiresAt: new Date(Date.now() - 1000),
      }),
    ).toBe("EXPIRED");
    expect(
      invitationEffectiveStatus({
        status: "PENDING",
        expiresAt: new Date(Date.now() + 60_000),
      }),
    ).toBe("PENDING");
  });

  it("matches invite emails case-insensitively", () => {
    expect(emailsMatchForInvite("a@b.com", "A@B.com")).toBe(true);
    expect(emailsMatchForInvite("a@b.com", "other@b.com")).toBe(false);
    expect(emailsMatchForInvite("a@b.com", null)).toBe(false);
  });
});

describe("invite redirects", () => {
  it("only allows /invite/accept return paths", () => {
    expect(isSafeInviteReturnTo(buildInviteAcceptPath("abc"))).toBe(true);
    expect(isSafeInviteReturnTo("/admin")).toBe(false);
    expect(isSafeInviteReturnTo("https://evil.example/invite/accept")).toBe(
      false,
    );
    expect(isSafeInviteReturnTo("//evil.example")).toBe(false);
  });
});
