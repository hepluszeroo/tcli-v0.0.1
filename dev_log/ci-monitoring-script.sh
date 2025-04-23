#!/bin/bash
# CI Monitoring Script for Memory Leak Fix
# Run this script to download and analyze CI logs

# Color codes for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${YELLOW}===== Memory Leak Fix Monitoring Script =====${NC}"
echo "This script helps monitor CI logs for signs of memory leaks"
echo ""

# Check if gh CLI is installed
if ! command -v gh &> /dev/null
then
    echo -e "${RED}Error: GitHub CLI (gh) is not installed or not in PATH${NC}"
    echo "Please install it from: https://cli.github.com/"
    exit 1
fi

# Check if jq is installed
if ! command -v jq &> /dev/null
then
    echo -e "${RED}Error: jq is not installed or not in PATH${NC}"
    echo "Please install it using your package manager (brew, apt, etc.)"
    exit 1
fi

# Prompt for repository information if not provided
REPO="${1:-hepluszeroo/tcli-v0.0.1}"
PR_NUMBER="${2:-0}"

if [ "$PR_NUMBER" -eq 0 ]; then
    echo -e "${YELLOW}Fetching recent workflow runs...${NC}"
    gh api "repos/$REPO/actions/runs" | jq '.workflow_runs | map({id: .id, name: .name, status: .status, conclusion: .conclusion, created_at: .created_at, html_url: .html_url}) | sort_by(.created_at) | reverse | .[0:5]'
    
    echo ""
    read -p "Enter workflow run ID to analyze: " WORKFLOW_ID
    
    if [ -z "$WORKFLOW_ID" ]; then
        echo -e "${RED}No workflow ID provided. Exiting.${NC}"
        exit 1
    fi
else
    echo -e "${YELLOW}Fetching workflow runs for PR #$PR_NUMBER...${NC}"
    WORKFLOW_ID=$(gh api "repos/$REPO/actions/runs?pull_request=$PR_NUMBER" | jq '.workflow_runs[0].id')
    
    if [ -z "$WORKFLOW_ID" ] || [ "$WORKFLOW_ID" = "null" ]; then
        echo -e "${RED}No workflow runs found for PR #$PR_NUMBER. Exiting.${NC}"
        exit 1
    fi
    
    echo -e "Found workflow run ID: $WORKFLOW_ID"
fi

# Create output directory
OUTPUT_DIR="ci-logs-$(date +%Y%m%d)"
mkdir -p "$OUTPUT_DIR"

# Download logs
echo -e "${YELLOW}Downloading workflow logs...${NC}"
gh api "repos/$REPO/actions/runs/$WORKFLOW_ID/logs" > "$OUTPUT_DIR/workflow-logs.zip"

# Extract logs
echo -e "${YELLOW}Extracting logs...${NC}"
unzip -q -o "$OUTPUT_DIR/workflow-logs.zip" -d "$OUTPUT_DIR"

# Analyze logs for memory patterns
echo -e "${YELLOW}Analyzing logs for memory patterns...${NC}"
grep -r "memory\|heap\|rss\|DEBUG_CANCEL\|MaxListenersExceededWarning\|pendingAborts\|abortListeners\|deliveryTimers" "$OUTPUT_DIR" > "$OUTPUT_DIR/memory-analysis.txt"

# Count occurrences of key patterns
PENDING_ABORTS_NONZERO=$(grep -r "pendingAborts=[^0]" "$OUTPUT_DIR" | wc -l)
ABORT_LISTENERS_NONZERO=$(grep -r "abortListeners=[^0]" "$OUTPUT_DIR" | wc -l)
DELIVERY_TIMERS_NONZERO=$(grep -r "deliveryTimers=[^0]" "$OUTPUT_DIR" | wc -l)
MAX_LISTENERS_WARNINGS=$(grep -r "MaxListenersExceededWarning" "$OUTPUT_DIR" | wc -l)
OOM_ERRORS=$(grep -r "out of memory\|OOM" "$OUTPUT_DIR" | wc -l)

# Print analysis summary
echo -e "${YELLOW}===== Analysis Summary =====${NC}"
echo "Non-zero pendingAborts count: $PENDING_ABORTS_NONZERO"
echo "Non-zero abortListeners count: $ABORT_LISTENERS_NONZERO"
echo "Non-zero deliveryTimers count: $DELIVERY_TIMERS_NONZERO"
echo "MaxListenersExceededWarning occurrences: $MAX_LISTENERS_WARNINGS"
echo "Out of memory error occurrences: $OOM_ERRORS"

# Provide assessment
echo -e "${YELLOW}===== Assessment =====${NC}"
if [ $PENDING_ABORTS_NONZERO -eq 0 ] && [ $ABORT_LISTENERS_NONZERO -eq 0 ] && [ $DELIVERY_TIMERS_NONZERO -eq 0 ] && [ $MAX_LISTENERS_WARNINGS -eq 0 ] && [ $OOM_ERRORS -eq 0 ]; then
    echo -e "${GREEN}✓ All memory metrics look good!${NC}"
    echo -e "${GREEN}✓ No signs of memory leaks detected in this run.${NC}"
else
    echo -e "${RED}⚠ Potential issues detected:${NC}"
    
    if [ $PENDING_ABORTS_NONZERO -gt 0 ]; then
        echo -e "${RED}  - Non-zero pendingAborts found in logs${NC}"
    fi
    
    if [ $ABORT_LISTENERS_NONZERO -gt 0 ]; then
        echo -e "${RED}  - Non-zero abortListeners found in logs${NC}"
    fi
    
    if [ $DELIVERY_TIMERS_NONZERO -gt 0 ]; then
        echo -e "${RED}  - Non-zero deliveryTimers found in logs${NC}"
    fi
    
    if [ $MAX_LISTENERS_WARNINGS -gt 0 ]; then
        echo -e "${RED}  - MaxListenersExceededWarning found in logs${NC}"
    fi
    
    if [ $OOM_ERRORS -gt 0 ]; then
        echo -e "${RED}  - Out of memory errors found in logs${NC}"
    fi
fi

echo ""
echo -e "${YELLOW}Detailed memory analysis written to:${NC} $OUTPUT_DIR/memory-analysis.txt"
echo -e "${YELLOW}Log files extracted to:${NC} $OUTPUT_DIR"
echo ""
echo -e "Run this command again with the PR number as an argument to analyze a specific PR:"
echo -e "  ./ci-monitoring-script.sh $REPO <PR_NUMBER>"
echo ""