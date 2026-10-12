---
name: aws
description: Use the AWS CLI with the AWS accounts and roles the user connected to Alfe. Use when the user asks you to inspect, query, or change anything in their AWS accounts.
---

# AWS

The user connected one or more AWS accounts to Alfe. Each connected account
identity and each role they selected is a named AWS CLI profile on this
machine. Credentials are short-lived and minted on demand; you never handle
access keys.

## 1. List the profiles first

```bash
alfe aws profiles
```

This prints each profile with its account ID, role, region and label. Pick
the profile that matches the account and access level the task needs. If
several could fit, ask the user which one to use. Use `alfe aws profiles --json`
when you need to parse the list.

`alfe aws profiles` lists what Alfe has connected, not what this machine has
configured. A profile is skipped here when its name is already used by one of
the user's own profiles in `~/.aws/config` or `~/.aws/credentials`. Confirm a
profile exists locally before you use it:

```bash
aws configure list-profiles
```

If a profile from `alfe aws profiles` is missing from that list, do not use
it and do not rename or edit the user's profiles. Tell the user the name
collides with one of their own AWS profiles.

If there are no profiles, the user has not finished connecting AWS. Ask them
to open **Connections → Add new connection → AWS** in the Alfe dashboard, or,
for an account that is already connected, use **Manage roles** on its row in
**Connections** to select at least one role (or keep the account's own
access).

## 2. Always pass `--profile`

```bash
aws sts get-caller-identity --profile <profile>
aws s3 ls --profile <profile>
aws ec2 describe-instances --profile <profile> --region us-west-2
```

- Pass `--profile <profile>` on every command. There is no default profile,
  and you must not create one, set `AWS_PROFILE` globally, or edit
  `~/.aws/config` or `~/.aws/credentials`.
- Each profile has a default region. Pass `--region` to work elsewhere.
- Start with `aws sts get-caller-identity --profile <profile>` when you are
  unsure which account or role a profile maps to.

## 3. Credentials refresh automatically

Profiles use `credential_process`, which fetches fresh temporary credentials
through Alfe whenever the cached ones are close to expiry. Do not run
`aws configure`, `aws sso login`, or try to obtain keys yourself. If a
command fails with an error from `alfe aws credentials`, report the message
to the user: the connection may be revoked, inactive, or the role may no
longer trust Alfe.

## 4. Know the limits of each profile

- A profile only has the permissions of its role. Read-only roles cannot
  change resources.
- The **Direct** profile of an account connected with access keys uses an
  STS session token, so it **cannot call IAM APIs** (for example
  `aws iam list-roles` fails). Use a role profile for IAM work, or tell the
  user that the task needs a role.
- Role sessions last at most one hour; long-running commands may need to be
  retried after a refresh.

## 5. When AWS denies access

On `AccessDenied`, `UnauthorizedOperation`, or a similar error, do not try
other profiles at random. Tell the user:

- which profile (account and role) you used,
- the exact action that was denied (for example `ec2:DescribeInstances`), and
- what to grant: add that permission to the role's policy, or connect a
  role with a broader access level with **Manage roles** on the AWS
  connection's row in **Connections**.

## 6. Never print credentials

Never run `alfe aws credentials` or `aws configure export-credentials`
yourself, and never echo, log, or paste access keys, secret keys, or
session tokens into chat, files, or commands. Destructive changes (deleting
resources, changing IAM, security groups, or billing) need the user's
explicit confirmation first.
