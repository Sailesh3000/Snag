# ApplyPilot --- Implementation Plan

## Overview

ApplyPilot is a local AI-powered job application copilot that activates
only on supported job application websites. It intelligently understands
application forms, retrieves user profile information, generates
tailored responses for open-ended questions, requests user approval
before filling, and continuously learns from approved edits.

------------------------------------------------------------------------

# Goals

-   Activate only on supported job application websites.
-   Automatically fill static profile information.
-   Generate personalized answers for application questions.
-   Keep the human in control with confirmation before filling.
-   Learn from previous applications to improve future responses.
-   Run entirely locally using Ollama + Qwen3.

------------------------------------------------------------------------

# Tech Stack

## Backend

-   Python
-   FastAPI
-   WebSockets
-   Strands SDK
-   Ollama (Qwen3:8B)

## Frontend

-   React
-   TailwindCSS
-   Framer Motion
-   shadcn/ui

## Browser

-   Chrome Extension (Manifest V3)
-   TypeScript

## Memory

-   SQLite
-   Qdrant

------------------------------------------------------------------------

# Architecture

``` text
Chrome Extension
      │
      ▼
 FastAPI Backend
      │
      ▼
Strands Orchestrator
      │
 ├── Page Agent
 ├── Profile Agent
 ├── Memory Agent
 ├── Answer Agent
 ├── Fill Agent
 └── Learning Agent
      │
      ▼
 Ollama (Qwen3)
```

------------------------------------------------------------------------

# Project Structure

``` text
apply-pilot/
├── backend/
│   ├── agents/
│   ├── tools/
│   ├── memory/
│   ├── prompts/
│   ├── api/
│   └── app.py
├── extension/
├── ui/
├── shared/
└── docs/
```

------------------------------------------------------------------------

# Implementation Phases

## Phase 1 --- Foundation

### Backend

-   FastAPI server
-   WebSocket support
-   Session manager
-   Ollama integration
-   Logging

### Browser Extension

-   Detect supported job sites
-   Extract form fields
-   Send DOM metadata

### UI

-   Floating sidebar
-   Connection status
-   Current job information

Deliverable: - Static profile autofill.

------------------------------------------------------------------------

## Phase 2 --- Profile System

SQLite tables:

-   Profile
-   Resume
-   Settings

Store:

-   Name
-   Email
-   Phone
-   Address
-   Resume paths
-   LinkedIn
-   GitHub
-   Education
-   Experience

Deliverable: - Reliable static autofill.

------------------------------------------------------------------------

## Phase 3 --- Form Understanding

Page Agent responsibilities:

-   Parse DOM
-   Classify fields
-   Detect question types
-   Confidence scoring

Field categories:

-   Static
-   File Upload
-   Select
-   Checkbox
-   Long Answer
-   Unknown

Deliverable: - Intelligent field classification.

------------------------------------------------------------------------

## Phase 4 --- Memory

Qdrant stores:

-   Previous questions
-   Answers
-   Company
-   Role
-   Embeddings
-   Tags

SQLite stores:

-   Structured profile
-   Sessions
-   Configuration

Deliverable: - Semantic retrieval.

------------------------------------------------------------------------

## Phase 5 --- Answer Generation

Pipeline:

Question → Retrieve similar answers → Retrieve profile → Retrieve job
description → Prompt Qwen → Draft answer

Never auto-submit.

Deliverable: - Suggested answers.

------------------------------------------------------------------------

## Phase 6 --- Fill Engine

Workflow

1.  Preview values
2.  User approves
3.  Fill DOM
4.  Highlight updated fields

Deliverable: - Safe autofill.

------------------------------------------------------------------------

## Phase 7 --- Learning

When user edits AI output:

Store

-   Original answer
-   Final answer
-   Company
-   Role
-   Timestamp

Update embeddings.

Deliverable: - Continuous improvement.

------------------------------------------------------------------------

# Agent Design

## Orchestrator

Responsibilities

-   Maintain session
-   Route tasks
-   Manage context
-   Execute workflows

------------------------------------------------------------------------

## Page Agent

Input

-   HTML
-   Labels
-   Placeholders

Output

-   Structured fields

------------------------------------------------------------------------

## Profile Agent

Returns

-   Static profile
-   Resume metadata

------------------------------------------------------------------------

## Memory Agent

Uses Qdrant.

Returns:

-   Similar answers
-   Relevant experiences
-   Previous company-specific responses

------------------------------------------------------------------------

## Answer Agent

Inputs

-   Question
-   Retrieved memories
-   Job description
-   Resume

Outputs

-   Draft answer
-   Confidence
-   Sources

------------------------------------------------------------------------

## Fill Agent

Responsibilities

-   Preview fills
-   Execute approved fills
-   Verify completion

------------------------------------------------------------------------

## Learning Agent

Responsibilities

-   Store edits
-   Update vector DB
-   Track usage statistics

------------------------------------------------------------------------

# Tools

-   retrieve_profile_tool
-   retrieve_memory_tool
-   save_memory_tool
-   classify_field_tool
-   generate_answer_tool
-   fill_field_tool
-   detect_job_site_tool

------------------------------------------------------------------------

# Database Schema

## profile

-   key
-   value
-   verified

## answers

-   question
-   answer
-   company
-   role
-   embedding
-   approved

## sessions

-   company
-   role
-   timestamp

## resumes

-   name
-   path
-   embedding

------------------------------------------------------------------------

# UI

## Sidebar

Sections

-   Job Info
-   Autofill Status
-   Questions
-   Generated Answers
-   Memory Suggestions
-   Activity

Design

-   Glassmorphism
-   Dark mode
-   Smooth animations
-   Minimal controls
-   Floating panel
-   Keyboard shortcuts

------------------------------------------------------------------------

# Security

-   Runs locally only
-   No cloud APIs by default
-   Explicit approval before filling
-   Encrypted local profile
-   Never auto-submit applications

------------------------------------------------------------------------

# Future Roadmap

-   Vision mode (Qwen-VL)
-   Resume recommendation
-   Cover letter generation
-   Recruiter research
-   Interview preparation
-   Voice approval
-   Analytics dashboard
-   Multi-browser support

------------------------------------------------------------------------

# Success Metrics

-   \< 2 second static autofill

-   95% field classification accuracy

-   \< 5 second answer generation

-   90% answer approval rate

-   Increasing reuse of previous answers over time
