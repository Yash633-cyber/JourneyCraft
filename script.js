
"use strict";

// =============================================
// JOURNEYCRAFT - SUPABASE DATABASE APPLICATION
// =============================================

const db = window.supabaseClient;

if (!db) {
    document.body.innerHTML = `
        <div style="padding:30px;font-family:Arial">
            <h2>Supabase connection not initialized</h2>
            <p>Check supabase-config.js and the script order in index.html.</p>
        </div>`;
    throw new Error("window.supabaseClient is not defined.");
}

// Application state
let journeys = [];
let currentJourneyId = null;
let isSignUpMode = false;
let saveTimer = null;
let saveInProgress = false;
let saveAgain = false;

// =============================================
// ELEMENT HELPERS
// =============================================

const $ = id => document.getElementById(id);

function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, character => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;"
    })[character]);
}

function setMessage(elementId, message) {
    const element = $(elementId);
    if (element) element.textContent = message;
}

function setSaveStatus(message, type = "") {
    const status = $("saveStatus");
    if (!status) return;

    status.textContent = message;
    status.className = "status " + type;
}

function defaultStages() {
    return [
        { name: "Discover", action: "", touchpoint: "", thought: "",
          emotion: "Neutral", painPoint: "", opportunity: "" },
        { name: "Explore", action: "", touchpoint: "", thought: "",
          emotion: "Neutral", painPoint: "", opportunity: "" },
        { name: "Purchase", action: "", touchpoint: "", thought: "",
          emotion: "Neutral", painPoint: "", opportunity: "" },
        { name: "Usage", action: "", touchpoint: "", thought: "",
          emotion: "Neutral", painPoint: "", opportunity: "" },
        { name: "Feedback", action: "", touchpoint: "", thought: "",
          emotion: "Neutral", painPoint: "", opportunity: "" }
    ];
}

// =============================================
// AUTHENTICATION
// =============================================

function showSignedIn(isSignedIn) {
    $("authSection").classList.toggle("hidden", isSignedIn);
    $("appLayout").classList.toggle("hidden", !isSignedIn);
}

$("authToggle").addEventListener("click", () => {
    isSignUpMode = !isSignUpMode;

    $("authSubmit").textContent =
        isSignUpMode ? "Create Account" : "Sign In";

    $("authToggle").textContent =
        isSignUpMode
            ? "Already registered? Sign In"
            : "Need an account? Sign Up";

    $("authPassword").autocomplete =
        isSignUpMode ? "new-password" : "current-password";

    setMessage("authMessage", "");
});

$("authForm").addEventListener("submit", async event => {
    event.preventDefault();

    const email = $("authEmail").value.trim();
    const password = $("authPassword").value;

    $("authSubmit").disabled = true;
    setMessage("authMessage", "Please wait...");

    try {
        let result;

        if (isSignUpMode) {
            result = await db.auth.signUp({ email, password });
        } else {
            result = await db.auth.signInWithPassword({ email, password });
        }

        if (result.error) throw result.error;

        if (isSignUpMode && !result.data.session) {
            setMessage(
                "authMessage",
                "Account created. Check your email to confirm your account, then sign in."
            );
        } else {
            setMessage("authMessage", "Signed in successfully.");
            await loadJourneys();
        }
    } catch (error) {
        setMessage("authMessage", error.message || "Authentication failed.");
    } finally {
        $("authSubmit").disabled = false;
    }
});

$("signOutBtn").addEventListener("click", async () => {
    const { error } = await db.auth.signOut();

    if (error) {
        alert("Could not sign out: " + error.message);
        return;
    }

    journeys = [];
    currentJourneyId = null;
    showSignedIn(false);
    setMessage("authMessage", "You have signed out.");
});

db.auth.onAuthStateChange((event, session) => {
    if (event === "SIGNED_OUT" || !session) {
        showSignedIn(false);
    } else {
        showSignedIn(true);
    }
});

// =============================================
// DATABASE: LOAD JOURNEYS
// =============================================

async function loadJourneys() {
    setSaveStatus("Loading journeys...");

    const { data, error } = await db
        .from("journeys")
        .select("*")
        .order("created_at", { ascending: false });

    if (error) {
        setSaveStatus("Could not load journeys.", "error");
        console.error("Load error:", error);
        alert("Unable to load journeys: " + error.message);
        return;
    }

    journeys = (data || []).map(row => ({
        id: row.id,
        journeyName: row.journey_name,
        customerName: row.customer_name,
        customerGoal: row.customer_goal || "",
        journeyScenario: row.journey_scenario || "",
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        stages: Array.isArray(row.stages) ? row.stages : defaultStages()
    }));

    currentJourneyId = null;
    showSignedIn(true);
    showPage("dashboard");
    setSaveStatus("All journeys loaded.", "saved");
}

// =============================================
// DATABASE: CREATE A JOURNEY
// =============================================

$("journeyForm").addEventListener("submit", async event => {
    event.preventDefault();

    const { data: userData, error: userError } =
        await db.auth.getUser();

    if (userError || !userData.user) {
        alert("Please sign in before creating a journey.");
        return;
    }

    const journey = {
        id: crypto.randomUUID(),
        user_id: userData.user.id,
        journey_name: $("journeyName").value.trim(),
        customer_name: $("customerName").value.trim(),
        customer_goal: $("customerGoal").value.trim(),
        journey_scenario: $("journeyScenario").value.trim(),
        stages: defaultStages()
    };

    if (!journey.journey_name || !journey.customer_name) {
        alert("Please enter a journey name and customer persona.");
        return;
    }

    $("createSubmitBtn").disabled = true;
    setSaveStatus("Creating journey...");

    const { data, error } = await db
        .from("journeys")
        .insert(journey)
        .select()
        .single();

    $("createSubmitBtn").disabled = false;

    if (error) {
        console.error("Create error:", error);
        setSaveStatus("Create failed.", "error");
        alert("Could not create journey: " + error.message);
        return;
    }

    journeys.unshift({
        id: data.id,
        journeyName: data.journey_name,
        customerName: data.customer_name,
        customerGoal: data.customer_goal || "",
        journeyScenario: data.journey_scenario || "",
        createdAt: data.created_at,
        stages: data.stages || defaultStages()
    });

    $("journeyForm").reset();
    currentJourneyId = data.id;

    setSaveStatus("Journey created and saved.", "saved");
    renderDashboard();
    showPage("journeys");
});

// =============================================
// DATABASE: UPDATE A JOURNEY
// =============================================

async function saveJourney(journey) {
    if (saveInProgress) {
        saveAgain = true;
        return;
    }

    saveInProgress = true;
    setSaveStatus("Saving changes...");

    try {
        do {
            saveAgain = false;

            const { data: userData, error: userError } =
                await db.auth.getUser();

            if (userError || !userData.user) {
                throw new Error("Please sign in again to save changes.");
            }

            const { error } = await db
                .from("journeys")
                .update({
                    journey_name: journey.journeyName,
                    customer_name: journey.customerName,
                    customer_goal: journey.customerGoal,
                    journey_scenario: journey.journeyScenario,
                    stages: journey.stages,
                    updated_at: new Date().toISOString()
                })
                .eq("id", journey.id)
                .eq("user_id", userData.user.id);

            if (error) throw error;
        } while (saveAgain);

        setSaveStatus("All changes saved.", "saved");
        renderDashboard();
    } catch (error) {
        console.error("Save error:", error);
        setSaveStatus("Save failed. Please retry.", "error");
    } finally {
        saveInProgress = false;

        if (saveAgain) {
            saveAgain = false;
            scheduleSave();
        }
    }
}

function scheduleSave() {
    clearTimeout(saveTimer);

    setSaveStatus("Unsaved changes...");

    saveTimer = setTimeout(() => {
        const journey = journeys.find(
            item => item.id === currentJourneyId
        );

        if (journey) saveJourney(journey);
    }, 800);
}

// =============================================
// DATABASE: DELETE A JOURNEY
// =============================================

async function deleteJourney(id) {
    if (!confirm("Delete this journey permanently?")) return;

    const { data: userData, error: userError } =
        await db.auth.getUser();

    if (userError || !userData.user) {
        alert("Please sign in again.");
        return;
    }

    setSaveStatus("Deleting journey...");

    const { error } = await db
        .from("journeys")
        .delete()
        .eq("id", id)
        .eq("user_id", userData.user.id);

    if (error) {
        setSaveStatus("Delete failed.", "error");
        alert("Could not delete journey: " + error.message);
        return;
    }

    journeys = journeys.filter(journey => journey.id !== id);

    if (currentJourneyId === id) currentJourneyId = null;

    setSaveStatus("Journey deleted.", "saved");
    showPage("journeys");
    renderDashboard();
}

// =============================================
// NAVIGATION
// =============================================

function showPage(pageName) {
    const pages = {
        dashboard: "dashboardPage",
        journeys: "journeysPage",
        customers: "customersPage",
        insights: "insightsPage",
        create: "createPage"
    };

    Object.values(pages).forEach(id => $(id).classList.add("hidden"));

    if (pages[pageName]) $(pages[pageName]).classList.remove("hidden");

    document.querySelectorAll("[data-page]").forEach(button => {
        button.classList.toggle(
            "active",
            button.dataset.page === pageName
        );
    });

    const headings = {
        dashboard: "Dashboard",
        journeys: currentJourneyId ? "Journey Editor" : "My Journeys",
        customers: "Customers",
        insights: "Insights",
        create: "Create Journey"
    };

    $("pageHeading").textContent = headings[pageName] || "JourneyCraft";
    $("createJourneyBtn").classList.toggle("hidden", pageName === "create");

    if (pageName === "dashboard") renderDashboard();
    if (pageName === "journeys") {
        currentJourneyId
            ? renderJourneyDetail(currentJourneyId)
            : renderAllJourneys();
    }
    if (pageName === "customers") renderCustomers();
    if (pageName === "insights") renderInsights();
}

document.querySelectorAll("[data-page]").forEach(button => {
    button.addEventListener("click", () => {
        if (button.dataset.page === "journeys") currentJourneyId = null;
        showPage(button.dataset.page);
    });
});

$("createJourneyBtn").addEventListener("click", () => showPage("create"));

// =============================================
// DASHBOARD
// =============================================

function renderDashboard() {
    $("totalJourneys").textContent = journeys.length;

    $("totalCustomers").textContent = new Set(
        journeys.map(item => item.customerName.toLowerCase())
    ).size;

    $("totalPainPoints").textContent = journeys.reduce(
        (total, journey) =>
            total + (journey.stages || []).filter(
                stage => stage.painPoint && stage.painPoint.trim()
            ).length,
        0
    );

    const recent = journeys.slice(0, 3);

    $("recentJourneys").innerHTML = recent.length
        ? recent.map(journey => journeyCard(journey, true)).join("")
        : `<div class="empty-state">
               <h3>No journeys yet</h3>
               <p>Create your first customer journey.</p>
               <button class="btn" data-action="create">Create Journey</button>
           </div>`;
}

function journeyCard(journey, compact = false) {
    return `
        <article class="journey-card">
            <h3>${escapeHTML(journey.journeyName)}</h3>
            <p><strong>Customer:</strong> ${escapeHTML(journey.customerName)}</p>
            ${compact ? "" : `
                <p><strong>Goal:</strong>
                    ${escapeHTML(journey.customerGoal || "Not provided")}
                </p>
                <p><strong>Stages:</strong> ${(journey.stages || []).length}</p>
                <p class="muted">Created: ${
                    escapeHTML(journey.createdAt
                        ? new Date(journey.createdAt).toLocaleDateString()
                        : "Recently")
                }</p>
            `}
            <div class="card-actions">
                <button class="btn" data-action="view"
                        data-id="${escapeHTML(journey.id)}">View Journey</button>
                ${compact ? "" : `
                    <button class="btn danger" data-action="delete"
                            data-id="${escapeHTML(journey.id)}">Delete</button>
                `}
            </div>
        </article>`;
}

// =============================================
// JOURNEY LIST AND EDITOR
// =============================================

function renderAllJourneys() {
    $("journeysPage").innerHTML = `
        <h2>My Journeys</h2>
        <p class="muted">Your journeys are stored in Supabase PostgreSQL.</p>
        <div class="journey-list">
            ${journeys.length
                ? journeys.map(journey => journeyCard(journey)).join("")
                : `<div class="empty-state">
                       <h3>Your journey list is empty</h3>
                       <p>Create a journey to begin mapping the experience.</p>
                       <button class="btn" data-action="create">Create Journey</button>
                   </div>`
            }
        </div>`;
}

function renderJourneyDetail(id) {
    const journey = journeys.find(item => item.id === id);

    if (!journey) {
        currentJourneyId = null;
        renderAllJourneys();
        return;
    }

    $("journeysPage").innerHTML = `
        <button class="btn secondary" data-action="back">← Back to Journeys</button>

        <div class="panel" style="margin-top:18px">
            <h2>${escapeHTML(journey.journeyName)}</h2>
            <p class="muted">Edits save automatically after you pause typing.</p>
            <p id="saveStatus" class="status saved">All changes saved.</p>

            <div class="field">
                <label>Journey Name</label>
                <input data-journey-field="journeyName"
                       value="${escapeHTML(journey.journeyName)}">
            </div>

            <div class="field">
                <label>Customer Persona</label>
                <input data-journey-field="customerName"
                       value="${escapeHTML(journey.customerName)}">
            </div>

            <div class="field">
                <label>Customer Goal</label>
                <textarea data-journey-field="customerGoal" rows="2">${escapeHTML(journey.customerGoal)}</textarea>
            </div>

            <div class="field">
                <label>Journey Scenario</label>
                <textarea data-journey-field="journeyScenario" rows="3">${escapeHTML(journey.journeyScenario)}</textarea>
            </div>
        </div>

        <h2 style="margin-top:28px">Customer Journey Stages</h2>
        <p class="muted">Update each stage. Your changes save automatically.</p>

        <div id="stageList" class="stage-list">
            ${journey.stages.map((stage, index) => stageEditor(stage, index)).join("")}
        </div>

        <div class="editor-actions" style="margin-top:20px">
            <button class="btn secondary" data-action="add-stage">+ Add Stage</button>
            <button class="btn secondary" data-action="back">Back to Journeys</button>
        </div>
    `;
}

function stageEditor(stage, index) {
    const emotions = ["Happy", "Neutral", "Confused", "Frustrated", "Sad"];

    return `
        <article class="stage-card">
            <div class="stage-heading">
                <h3>Stage ${index + 1}</h3>
                <button class="btn danger" data-action="remove-stage"
                        data-index="${index}">Remove</button>
            </div>

            <div class="field">
                <label>Stage Name</label>
                <input data-stage-field="name" data-index="${index}"
                       value="${escapeHTML(stage.name)}">
            </div>

            <div class="two-columns">
                <div class="field">
                    <label>Customer Action</label>
                    <textarea data-stage-field="action" data-index="${index}"
                              rows="2">${escapeHTML(stage.action)}</textarea>
                </div>
                <div class="field">
                    <label>Touchpoint</label>
                    <input data-stage-field="touchpoint" data-index="${index}"
                           value="${escapeHTML(stage.touchpoint)}"
                           placeholder="App, website, store...">
                </div>
                <div class="field">
                    <label>Customer Thought</label>
                    <textarea data-stage-field="thought" data-index="${index}"
                              rows="2">${escapeHTML(stage.thought)}</textarea>
                </div>
                <div class="field">
                    <label>Customer Emotion</label>
                    <select data-stage-field="emotion" data-index="${index}">
                        ${emotions.map(emotion => `
                            <option value="${emotion}"
                                ${stage.emotion === emotion ? "selected" : ""}>
                                ${emotion}
                            </option>
                        `).join("")}
                    </select>
                </div>
                <div class="field">
                    <label>Pain Point</label>
                    <textarea data-stage-field="painPoint" data-index="${index}"
                              rows="2">${escapeHTML(stage.painPoint)}</textarea>
                </div>
                <div class="field">
                    <label>Improvement Opportunity</label>
                    <textarea data-stage-field="opportunity" data-index="${index}"
                              rows="2">${escapeHTML(stage.opportunity)}</textarea>
                </div>
            </div>
        </article>`;
}

// =============================================
// AUTOMATIC SAVE WHEN EDITING
// =============================================

$("journeysPage").addEventListener("input", event => {
    const journey = journeys.find(item => item.id === currentJourneyId);
    if (!journey) return;

    const journeyField = event.target.dataset.journeyField;
    const stageField = event.target.dataset.stageField;

    if (journeyField) {
        journey[journeyField] = event.target.value;
        scheduleSave();
        return;
    }

    if (stageField) {
        const index = Number(event.target.dataset.index);
        if (!journey.stages[index]) return;

        journey.stages[index][stageField] = event.target.value;
        scheduleSave();
    }
});

$("journeysPage").addEventListener("change", event => {
    const journey = journeys.find(item => item.id === currentJourneyId);
    if (!journey) return;

    const field = event.target.dataset.stageField;

    if (field === "emotion") {
        const index = Number(event.target.dataset.index);
        if (journey.stages[index]) {
            journey.stages[index].emotion = event.target.value;
            scheduleSave();
        }
    }
});

// =============================================
// BUTTON ACTIONS
// =============================================

document.addEventListener("click", async event => {
    const button = event.target.closest("[data-action]");
    if (!button) return;

    const action = button.dataset.action;

    if (action === "create") {
        showPage("create");
        return;
    }

    if (action === "view") {
        currentJourneyId = button.dataset.id;
        showPage("journeys");
        return;
    }

    if (action === "back") {
        clearTimeout(saveTimer);
        currentJourneyId = null;
        showPage("journeys");
        return;
    }

    if (action === "delete") {
        await deleteJourney(button.dataset.id);
        return;
    }

    if (action === "add-stage") {
        const journey = journeys.find(item => item.id === currentJourneyId);
        if (!journey) return;

        journey.stages.push({
            name: "New Stage",
            action: "",
            touchpoint: "",
            thought: "",
            emotion: "Neutral",
            painPoint: "",
            opportunity: ""
        });

        renderJourneyDetail(currentJourneyId);
        scheduleSave();
        return;
    }

    if (action === "remove-stage") {
        const journey = journeys.find(item => item.id === currentJourneyId);
        if (!journey) return;

        if (journey.stages.length <= 1) {
            alert("Keep at least one stage in your journey.");
            return;
        }

        journey.stages.splice(Number(button.dataset.index), 1);
        renderJourneyDetail(currentJourneyId);
        scheduleSave();
    }
});

// =============================================
// CUSTOMER PROFILES AND INSIGHTS
// =============================================

function renderCustomers() {
    const unique = new Map();

    journeys.forEach(journey => {
        const key = journey.customerName.toLowerCase();

        if (!unique.has(key)) {
            unique.set(key, {
                name: journey.customerName,
                goals: journey.customerGoal,
                count: 0
            });
        }

        unique.get(key).count++;
    });

    const customers = [...unique.values()];

    $("customersPage").innerHTML = `
        <h2>Customer Profiles</h2>
        <p class="muted">Customer personas from your saved journeys.</p>
        <div class="journey-list">
            ${customers.length
                ? customers.map(customer => `
                    <article class="journey-card">
                        <h3>${escapeHTML(customer.name)}</h3>
                        <p>Journeys: ${customer.count}</p>
                        <p>Goal: ${escapeHTML(customer.goals || "Not provided")}</p>
                    </article>
                `).join("")
                : `<div class="empty-state">Create a journey to add a customer profile.</div>`
            }
        </div>`;
}

function renderInsights() {
    const stages = journeys.flatMap(journey => journey.stages || []);
    const pains = stages.filter(stage => stage.painPoint && stage.painPoint.trim());
    const opportunities = stages.filter(
        stage => stage.opportunity && stage.opportunity.trim()
    );

    $("insightsPage").innerHTML = `
        <h2>Journey Insights</h2>
        <p class="muted">Review customer difficulties and improvement ideas.</p>

        <div class="stats-grid">
            <div class="panel">
                <p class="muted">Journeys</p>
                <p class="stat-number">${journeys.length}</p>
            </div>
            <div class="panel">
                <p class="muted">Pain Points</p>
                <p class="stat-number">${pains.length}</p>
            </div>
            <div class="panel">
                <p class="muted">Improvement Ideas</p>
                <p class="stat-number">${opportunities.length}</p>
            </div>
        </div>

        <div class="panel">
            <h3>Customer Pain Points</h3>
            ${pains.length
                ? `<ul>${pains.map(stage =>
                    `<li><strong>${escapeHTML(stage.name)}:</strong>
                    ${escapeHTML(stage.painPoint)}</li>`
                ).join("")}</ul>`
                : `<p class="muted">Add pain points in a journey to see them here.</p>`
            }
        </div>

        <div class="panel" style="margin-top:18px">
            <h3>Improvement Opportunities</h3>
            ${opportunities.length
                ? `<ul>${opportunities.map(stage =>
                    `<li><strong>${escapeHTML(stage.name)}:</strong>
                    ${escapeHTML(stage.opportunity)}</li>`
                ).join("")}</ul>`
                : `<p class="muted">Add improvement ideas in a journey to see them here.</p>`
            }
        </div>`;
}

// =============================================
// START THE APPLICATION
// =============================================

async function startApp() {
    const { data, error } = await db.auth.getSession();

    if (error) {
        console.error("Session error:", error);
        showSignedIn(false);
        setMessage("authMessage", error.message);
        return;
    }

    if (data.session) {
        showSignedIn(true);
        await loadJourneys();
    } else {
        showSignedIn(false);
    }
}

startApp();
