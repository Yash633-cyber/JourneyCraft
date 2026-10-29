
const db = window.supabaseClient;

let journeys = [];
let feedbackEntries = [];
let currentJourneyId = null;
let isSignUpMode = false;
let saveTimer = null;
let saveInProgress = false;
let saveAgain = false;
let feedbackModuleInitialized = false;

// ==========================================
// 1. COMMON HELPERS
// ==========================================

function $(id) {
    return document.getElementById(id);
}

function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, function (character) {
        const entities = {
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#039;"
        };

        return entities[character];
    });
}

function setMessage(element, message, type = "info") {
    if (!element) return;

    element.textContent = message;
    element.className = `message ${type}`;
}

function setSaveStatus(message) {
    const status = $("saveStatus");

    if (status) {
        status.textContent = message;
    }
}

function getCurrentUser() {
    return db?.auth ? db.auth.getUser() : Promise.resolve({
        data: { user: null },
        error: new Error("Supabase is not configured.")
    });
}

function defaultStages() {
    return [
        {
            name: "Awareness",
            description: "The customer discovers the product or service.",
            actions: "",
            thoughts: "",
            emotions: "Curious",
            painPoints: "",
            opportunities: ""
        },
        {
            name: "Consideration",
            description: "The customer explores available options.",
            actions: "",
            thoughts: "",
            emotions: "Interested",
            painPoints: "",
            opportunities: ""
        },
        {
            name: "Purchase",
            description: "The customer decides to buy or use the service.",
            actions: "",
            thoughts: "",
            emotions: "Hopeful",
            painPoints: "",
            opportunities: ""
        },
        {
            name: "Experience",
            description: "The customer uses the product or service.",
            actions: "",
            thoughts: "",
            emotions: "Satisfied",
            painPoints: "",
            opportunities: ""
        },
        {
            name: "Loyalty",
            description: "The customer decides whether to return or recommend.",
            actions: "",
            thoughts: "",
            emotions: "Connected",
            painPoints: "",
            opportunities: ""
        }
    ];
}

// ==========================================
// 2. AUTHENTICATION
// ==========================================

function setAuthMode(signUp) {
    isSignUpMode = signUp;

    const submitButton = $("authSubmit");
    const toggleButton = $("authToggle");
    const heading = $("authHeading");

    if (submitButton) {
        submitButton.textContent = signUp ? "Create Account" : "Sign In";
    }

    if (toggleButton) {
        toggleButton.textContent = signUp
            ? "Already have an account? Sign in"
            : "New to JourneyCraft? Create an account";
    }

    if (heading) {
        heading.textContent = signUp
            ? "Create Your JourneyCraft Account"
            : "Welcome Back";
    }

    setMessage($("authMessage"), "");
}

async function handleAuthSubmit(event) {
    event.preventDefault();

    if (!db) {
        setMessage(
            $("authMessage"),
            "Supabase configuration is missing.",
            "error"
        );
        return;
    }

    const email = $("authEmail")?.value.trim();
    const password = $("authPassword")?.value;

    if (!email || !password) {
        setMessage(
            $("authMessage"),
            "Enter your email and password.",
            "error"
        );
        return;
    }

    const submitButton = $("authSubmit");

    if (submitButton) {
        submitButton.disabled = true;
        submitButton.textContent = "Please wait...";
    }

    try {
        let result;

        if (isSignUpMode) {
            result = await db.auth.signUp({
                email,
                password
            });

            if (!result.error && !result.data.session) {
                setMessage(
                    $("authMessage"),
                    "Account created. Check your email if confirmation is required.",
                    "success"
                );
            }
        } else {
            result = await db.auth.signInWithPassword({
                email,
                password
            });
        }

        if (result.error) {
            throw result.error;
        }

        if (!isSignUpMode && result.data.session) {
            await startApp();
        } else if (isSignUpMode && result.data.session) {
            await startApp();
        }
    } catch (error) {
        setMessage(
            $("authMessage"),
            error.message || "Authentication failed.",
            "error"
        );
    } finally {
        if (submitButton) {
            submitButton.disabled = false;
            submitButton.textContent = isSignUpMode
                ? "Create Account"
                : "Sign In";
        }
    }
}

async function handleSignOut() {
    if (!db) return;

    const { error } = await db.auth.signOut();

    if (error) {
        alert(error.message);
        return;
    }

    journeys = [];
    feedbackEntries = [];
    currentJourneyId = null;

    if ($("appLayout")) {
        $("appLayout").classList.add("hidden");
    }

    if ($("authSection")) {
        $("authSection").classList.remove("hidden");
    }

    setAuthMode(false);
}

function showSignedIn() {
    if ($("authSection")) {
        $("authSection").classList.add("hidden");
    }

    if ($("appLayout")) {
        $("appLayout").classList.remove("hidden");
    }
}

// ==========================================
// 3. LOAD AND MANAGE JOURNEYS
// ==========================================

async function loadJourneys() {
    if (!db) return;

    const { data: userData, error: userError } =
        await db.auth.getUser();

    if (userError || !userData.user) {
        return;
    }

    const { data, error } = await db
        .from("journeys")
        .select("*")
        .order("created_at", { ascending: false });

    if (error) {
        console.error("Could not load journeys:", error);
        alert("Could not load journeys: " + error.message);
        return;
    }

    journeys = (data || []).map((row) => ({
        id: row.id,
        userId: row.user_id,
        journeyName: row.journey_name,
        customerName: row.customer_name,
        customerGoal: row.customer_goal,
        journeyScenario: row.journey_scenario,
        stages: Array.isArray(row.stages) && row.stages.length
            ? row.stages
            : defaultStages(),
        createdAt: row.created_at
    }));

    renderDashboard();
    renderAllJourneys();
    renderCustomers();
    renderInsights();

    showPage("dashboard");
}

async function createJourney(event) {
    if (event) event.preventDefault();

    if (!db) return;

    const journeyName = $("journeyName")?.value.trim();
    const customerName = $("customerName")?.value.trim();
    const customerGoal = $("customerGoal")?.value.trim();
    const journeyScenario = $("journeyScenario")?.value.trim();

    if (!journeyName || !customerName) {
        setMessage(
            $("saveStatus"),
            "Enter a journey name and customer name.",
            "error"
        );
        return;
    }

    const button = $("createSubmitBtn");

    if (button) {
        button.disabled = true;
        button.textContent = "Creating...";
    }

    try {
        const { data: userData, error: userError } =
            await db.auth.getUser();

        if (userError || !userData.user) {
            throw new Error("Please sign in again.");
        }

        const newJourney = {
            id: crypto.randomUUID(),
            user_id: userData.user.id,
            journey_name: journeyName,
            customer_name: customerName,
            customer_goal: customerGoal || "",
            journey_scenario: journeyScenario || "",
            stages: defaultStages()
        };

        const { data, error } = await db
            .from("journeys")
            .insert(newJourney)
            .select()
            .single();

        if (error) throw error;

        journeys.unshift({
            id: data.id,
            userId: data.user_id,
            journeyName: data.journey_name,
            customerName: data.customer_name,
            customerGoal: data.customer_goal,
            journeyScenario: data.journey_scenario,
            stages: data.stages || defaultStages(),
            createdAt: data.created_at
        });

        $("journeyForm")?.reset();

        renderDashboard();
        renderAllJourneys();
        renderCustomers();
        renderInsights();

        currentJourneyId = data.id;
        showPage("journeys");
        renderJourneyDetail(data.id);

        setSaveStatus("Journey created successfully.");
    } catch (error) {
        console.error("Journey creation failed:", error);
        setMessage(
            $("saveStatus"),
            "Could not create journey: " + error.message,
            "error"
        );
    } finally {
        if (button) {
            button.disabled = false;
            button.textContent = "Create Journey";
        }
    }
}

async function saveJourney(journey) {
    if (!db || !journey) return;

    if (saveInProgress) {
        saveAgain = true;
        return;
    }

    saveInProgress = true;
    setSaveStatus("Saving...");

    try {
        const { data: userData, error: userError } =
            await db.auth.getUser();

        if (userError || !userData.user) {
            throw new Error("Your session has expired.");
        }

        const { error } = await db
            .from("journeys")
            .update({
                journey_name: journey.journeyName,
                customer_name: journey.customerName,
                customer_goal: journey.customerGoal,
                journey_scenario: journey.journeyScenario,
                stages: journey.stages
            })
            .eq("id", journey.id)
            .eq("user_id", userData.user.id);

        if (error) throw error;

        setSaveStatus("All changes saved.");
    } catch (error) {
        console.error("Journey save failed:", error);
        setSaveStatus("Save failed: " + error.message);
    } finally {
        saveInProgress = false;

        if (saveAgain) {
            saveAgain = false;

            const latestJourney = journeys.find(
                (item) => item.id === currentJourneyId
            );

            if (latestJourney) {
                saveJourney(latestJourney);
            }
        }
    }
}

function scheduleSave(journey) {
    clearTimeout(saveTimer);

    setSaveStatus("Unsaved changes...");

    saveTimer = setTimeout(() => {
        saveJourney(journey);
    }, 800);
}

async function deleteJourney(id) {
    if (!db || !id) return;

    const confirmed = confirm(
        "Delete this customer journey and its related feedback?"
    );

    if (!confirmed) return;

    const { data: userData, error: userError } =
        await db.auth.getUser();

    if (userError || !userData.user) {
        alert("Please sign in again.");
        return;
    }

    const { error } = await db
        .from("journeys")
        .delete()
        .eq("id", id)
        .eq("user_id", userData.user.id);

    if (error) {
        alert("Could not delete journey: " + error.message);
        return;
    }

    journeys = journeys.filter((journey) => journey.id !== id);
    feedbackEntries = feedbackEntries.filter(
        (entry) => String(entry.journey_id) !== String(id)
    );

    currentJourneyId = null;

    renderDashboard();
    renderAllJourneys();
    renderCustomers();
    renderInsights();
    renderFeedback();
    showPage("journeys");
}

// ==========================================
// 4. PAGE NAVIGATION
// ==========================================

function showPage(pageName) {
    const pageMap = {
        dashboard: "dashboardPage",
        journeys: "journeysPage",
        customers: "customersPage",
        insights: "insightsPage",
        create: "createPage",
        feedback: "feedbackPage"
    };

    Object.values(pageMap).forEach((id) => {
        const page = $(id);

        if (page) {
            page.classList.add("hidden");
        }
    });

    const target = $(pageMap[pageName]);

    if (target) {
        target.classList.remove("hidden");
    }

    document.querySelectorAll("[data-page]").forEach((button) => {
        button.classList.toggle(
            "active",
            button.dataset.page === pageName
        );
    });

    const headings = {
        dashboard: "Dashboard",
        journeys: "Customer Journeys",
        customers: "Customers",
        insights: "Journey Insights",
        create: "Create Journey",
        feedback: "Customer Feedback"
    };

    if ($("pageHeading")) {
        $("pageHeading").textContent =
            headings[pageName] || "JourneyCraft";
    }

    if (pageName === "dashboard") renderDashboard();
    if (pageName === "journeys") renderAllJourneys();
    if (pageName === "customers") renderCustomers();
    if (pageName === "insights") renderInsights();

    if (pageName === "feedback") {
        renderFeedback();
        loadFeedbackEntries();
    }
}

// ==========================================
// 5. DASHBOARD
// ==========================================

function renderDashboard() {
    const totalJourneys = $("totalJourneys");
    const totalCustomers = $("totalCustomers");
    const totalPainPoints = $("totalPainPoints");
    const recentJourneys = $("recentJourneys");

    if (totalJourneys) {
        totalJourneys.textContent = journeys.length;
    }

    if (totalCustomers) {
        totalCustomers.textContent = new Set(
            journeys.map((journey) =>
                journey.customerName.trim().toLowerCase()
            )
        ).size;
    }

    if (totalPainPoints) {
        totalPainPoints.textContent = journeys.reduce(
            (total, journey) => total +
                (journey.stages || []).filter((stage) =>
                    Boolean(
                        typeof stage === "string"
                            ? false
                            : stage.painPoints?.trim()
                    )
                ).length,
            0
        );
    }

    if (!recentJourneys) return;

    const recent = journeys.slice(0, 5);

    if (!recent.length) {
        recentJourneys.innerHTML = `
            <div class="empty-state">
                <h3>Start your first journey</h3>
                <p>Create a customer journey to understand your customers better.</p>
            </div>
        `;
        return;
    }

    recentJourneys.innerHTML = recent
        .map((journey) => journeyCard(journey))
        .join("");
}

function journeyCard(journey) {
    const createdDate = journey.createdAt
        ? new Date(journey.createdAt).toLocaleDateString()
        : "Recently created";

    return `
        <article class="journey-card">
            <div class="journey-card-content">
                <h3>${escapeHTML(journey.journeyName)}</h3>
                <p>Customer: ${escapeHTML(journey.customerName)}</p>
                <p class="muted">${escapeHTML(journey.customerGoal || "No goal added")}</p>
                <small>${escapeHTML(createdDate)}</small>
            </div>

            <button
                type="button"
                class="btn-secondary"
                data-action="view"
                data-id="${escapeHTML(journey.id)}">
                Open
            </button>
        </article>
    `;
}

// ==========================================
// 6. JOURNEY LIST AND EDITOR
// ==========================================

function renderAllJourneys() {
    const container = $("journeysPage");

    if (!container) return;

    if (currentJourneyId) {
        renderJourneyDetail(currentJourneyId);
        return;
    }

    container.innerHTML = `
        <div class="page-toolbar">
            <div>
                <h2>All Customer Journeys</h2>
                <p class="muted">Create and manage your customer experiences.</p>
            </div>

            <button
                type="button"
                class="btn-primary"
                data-action="create">
                + New Journey
            </button>
        </div>

        <div class="journey-list">
            ${
                journeys.length
                    ? journeys.map((journey) => journeyCard(journey)).join("")
                    : `<div class="empty-state">
                        <h3>No journeys yet</h3>
                        <p>Create your first journey to get started.</p>
                       </div>`
            }
        </div>
    `;
}

function getStageValue(stage, property) {
    if (typeof stage === "string") {
        return property === "name" ? stage : "";
    }

    return stage?.[property] ?? "";
}

function renderJourneyDetail(id) {
    const container = $("journeysPage");

    if (!container) return;

    const journey = journeys.find(
        (item) => String(item.id) === String(id)
    );

    if (!journey) {
        currentJourneyId = null;
        renderAllJourneys();
        return;
    }

    if (!Array.isArray(journey.stages)) {
        journey.stages = defaultStages();
    }

    container.innerHTML = `
        <div class="page-toolbar">
            <button
                type="button"
                class="btn-secondary"
                data-action="back">
                ← All Journeys
            </button>

            <button
                type="button"
                class="btn-danger"
                data-action="delete"
                data-id="${escapeHTML(journey.id)}">
                Delete Journey
            </button>
        </div>

        <div class="panel survey-owner-panel">
            <div class="page-toolbar">
                <div>
                    <h2>Public Customer Survey</h2>
                    <p class="muted">Share a link so customers can vote on the hardest journey stage without creating an account.</p>
                </div>
                <button type="button" class="btn-primary" data-action="generate-survey" data-id="${escapeHTML(journey.id)}">Create / Refresh Survey Link</button>
            </div>
            <div id="surveyLinkArea" class="survey-link-area">
                <p class="muted">Create a survey link to collect customer votes.</p>
            </div>
            <div id="surveyAnalytics" class="survey-analytics">
                <p class="muted">Survey results will appear here after customers vote.</p>
            </div>
        </div>

        <div class="panel">
            <h2>Journey Details</h2>

            <div class="form-grid">
                <div class="form-group">
                    <label for="editJourneyName">Journey Name</label>
                    <input
                        id="editJourneyName"
                        data-field="journeyName"
                        value="${escapeHTML(journey.journeyName)}">
                </div>

                <div class="form-group">
                    <label for="editCustomerName">Customer Name</label>
                    <input
                        id="editCustomerName"
                        data-field="customerName"
                        value="${escapeHTML(journey.customerName)}">
                </div>

                <div class="form-group">
                    <label for="editCustomerGoal">Customer Goal</label>
                    <input
                        id="editCustomerGoal"
                        data-field="customerGoal"
                        value="${escapeHTML(journey.customerGoal)}">
                </div>

                <div class="form-group">
                    <label for="editJourneyScenario">Scenario</label>
                    <textarea
                        id="editJourneyScenario"
                        data-field="journeyScenario">${escapeHTML(journey.journeyScenario)}</textarea>
                </div>
            </div>
        </div>

        <div class="journey-stages">
            <div class="page-toolbar">
                <div>
                    <h2>Journey Stages</h2>
                    <p class="muted">Record customer actions, thoughts, feelings, and opportunities.</p>
                </div>

                <button
                    type="button"
                    class="btn-primary"
                    data-action="add-stage">
                    + Add Stage
                </button>
            </div>

            ${journey.stages.map((stage, index) =>
                stageEditor(stage, index)
            ).join("")}
        </div>
    `;

    setSaveStatus("Ready to edit.");
    loadExistingSurveyLink(id);
}

function stageEditor(stage, index) {
    const values = {
        name: getStageValue(stage, "name"),
        description: getStageValue(stage, "description"),
        actions: getStageValue(stage, "actions"),
        thoughts: getStageValue(stage, "thoughts"),
        emotions: getStageValue(stage, "emotions"),
        painPoints: getStageValue(stage, "painPoints"),
        opportunities: getStageValue(stage, "opportunities")
    };

    return `
        <article class="panel stage-card">
            <div class="page-toolbar">
                <h3>Stage ${index + 1}</h3>

                <button
                    type="button"
                    class="btn-danger"
                    data-action="remove-stage"
                    data-index="${index}">
                    Remove Stage
                </button>
            </div>

            <div class="form-grid">
                <div class="form-group">
                    <label>Stage Name</label>
                    <input
                        data-stage-index="${index}"
                        data-stage-field="name"
                        value="${escapeHTML(values.name)}">
                </div>

                <div class="form-group">
                    <label>Description</label>
                    <input
                        data-stage-index="${index}"
                        data-stage-field="description"
                        value="${escapeHTML(values.description)}">
                </div>

                <div class="form-group">
                    <label>Customer Actions</label>
                    <textarea
                        data-stage-index="${index}"
                        data-stage-field="actions">${escapeHTML(values.actions)}</textarea>
                </div>

                <div class="form-group">
                    <label>Customer Thoughts</label>
                    <textarea
                        data-stage-index="${index}"
                        data-stage-field="thoughts">${escapeHTML(values.thoughts)}</textarea>
                </div>

                <div class="form-group">
                    <label>Customer Emotions</label>
                    <input
                        data-stage-index="${index}"
                        data-stage-field="emotions"
                        value="${escapeHTML(values.emotions)}">
                </div>

                <div class="form-group">
                    <label>Pain Points</label>
                    <textarea
                        data-stage-index="${index}"
                        data-stage-field="painPoints">${escapeHTML(values.painPoints)}</textarea>
                </div>

                <div class="form-group full-width">
                    <label>Opportunities for Improvement</label>
                    <textarea
                        data-stage-index="${index}"
                        data-stage-field="opportunities">${escapeHTML(values.opportunities)}</textarea>
                </div>
            </div>
        </article>
    `;
}

// ==========================================
// 7. CUSTOMERS
// ==========================================

function renderCustomers() {
    const container = $("customersPage");

    if (!container) return;

    const customers = new Map();

    journeys.forEach((journey) => {
        const key = journey.customerName.trim().toLowerCase();

        if (!customers.has(key)) {
            customers.set(key, {
                name: journey.customerName,
                journeys: []
            });
        }

        customers.get(key).journeys.push(journey);
    });

    const customerList = Array.from(customers.values());

    container.innerHTML = `
        <div class="page-toolbar">
            <div>
                <h2>Customers</h2>
                <p class="muted">Customers represented in your journey maps.</p>
            </div>
        </div>

        <div class="customer-grid">
            ${
                customerList.length
                    ? customerList.map((customer) => `
                        <article class="panel customer-card">
                            <h3>${escapeHTML(customer.name)}</h3>
                            <p>${customer.journeys.length} journey(s)</p>
                            <div>
                                ${customer.journeys.map((journey) => `
                                    <button
                                        type="button"
                                        class="text-button"
                                        data-action="view"
                                        data-id="${escapeHTML(journey.id)}">
                                        ${escapeHTML(journey.journeyName)}
                                    </button>
                                `).join("")}
                            </div>
                        </article>
                    `).join("")
                    : `<div class="empty-state">
                        <h3>No customers yet</h3>
                        <p>Create a journey to add a customer.</p>
                       </div>`
            }
        </div>
    `;
}

// ==========================================
// 8. INSIGHTS
// ==========================================

function renderInsights() {
    const container = $("insightsPage");

    if (!container) return;

    const allStages = journeys.flatMap((journey) =>
        (journey.stages || []).map((stage) => ({
            journeyName: journey.journeyName,
            ...(
                typeof stage === "string"
                    ? { name: stage }
                    : stage
            )
        }))
    );

    const painPoints = allStages.filter(
        (stage) => stage.painPoints?.trim()
    );

    const opportunities = allStages.filter(
        (stage) => stage.opportunities?.trim()
    );

    const emotionCounts = {};

    allStages.forEach((stage) => {
        const emotion = stage.emotions?.trim();

        if (emotion) {
            emotionCounts[emotion] = (emotionCounts[emotion] || 0) + 1;
        }
    });

    container.innerHTML = `
        <div class="page-toolbar">
            <div>
                <h2>Journey Insights</h2>
                <p class="muted">Identify customer problems and improvement opportunities.</p>
            </div>
        </div>

        <div class="stats-grid">
            <div class="stat-card">
                <span class="stat-number">${journeys.length}</span>
                <span class="stat-label">Total Journeys</span>
            </div>

            <div class="stat-card">
                <span class="stat-number">${painPoints.length}</span>
                <span class="stat-label">Stages with Pain Points</span>
            </div>

            <div class="stat-card">
                <span class="stat-number">${opportunities.length}</span>
                <span class="stat-label">Improvement Opportunities</span>
            </div>
        </div>

        <div class="panel">
            <h3>Customer Pain Points</h3>

            ${
                painPoints.length
                    ? painPoints.map((stage) => `
                        <div class="insight-item">
                            <strong>${escapeHTML(stage.journeyName)} — ${escapeHTML(stage.name || "Stage")}</strong>
                            <p>${escapeHTML(stage.painPoints)}</p>
                        </div>
                    `).join("")
                    : `<p class="muted">Add pain points to journey stages to see them here.</p>`
            }
        </div>

        <div class="panel">
            <h3>Improvement Opportunities</h3>

            ${
                opportunities.length
                    ? opportunities.map((stage) => `
                        <div class="insight-item">
                            <strong>${escapeHTML(stage.journeyName)} — ${escapeHTML(stage.name || "Stage")}</strong>
                            <p>${escapeHTML(stage.opportunities)}</p>
                        </div>
                    `).join("")
                    : `<p class="muted">Add improvement opportunities to journey stages to see them here.</p>`
            }
        </div>

        <div class="panel">
            <h3>Customer Emotions</h3>

            ${
                Object.keys(emotionCounts).length
                    ? Object.entries(emotionCounts).map(([emotion, count]) => `
                        <div class="emotion-row">
                            <span>${escapeHTML(emotion)}</span>
                            <strong>${count}</strong>
                        </div>
                    `).join("")
                    : `<p class="muted">Add emotions to journey stages to see insights here.</p>`
            }
        </div>
    `;
}

// ==========================================
// 9. CUSTOMER FEEDBACK
// ==========================================

function getFeedbackStageNames(journey) {
    const stages = Array.isArray(journey?.stages)
        ? journey.stages
        : [];

    return stages.map((stage) => {
        return typeof stage === "string"
            ? stage
            : stage?.name || stage?.stage_name || "Unnamed Stage";
    });
}

function renderFeedback() {
    const container = $("feedbackContent");

    if (!container) return;

    const journeyOptions = journeys.map((journey) => `
        <option value="${escapeHTML(journey.id)}">
            ${escapeHTML(journey.journeyName)}
        </option>
    `).join("");

    container.innerHTML = `
        <form id="feedbackForm">
            <div class="form-grid feedback-form-grid">
                <div class="form-group">
                    <label for="feedbackJourney">Customer Journey</label>

                    <select id="feedbackJourney" required>
                        <option value="">Select a journey</option>
                        ${journeyOptions}
                    </select>
                </div>

                <div class="form-group">
                    <label for="feedbackStage">Journey Stage</label>

                    <select id="feedbackStage" required>
                        <option value="">Select a stage</option>
                    </select>
                </div>

                <div class="form-group">
                    <label for="feedbackRating">Satisfaction Rating</label>

                    <select id="feedbackRating" required>
                        <option value="">Select a rating</option>
                        <option value="5">5 - Excellent</option>
                        <option value="4">4 - Good</option>
                        <option value="3">3 - Average</option>
                        <option value="2">2 - Poor</option>
                        <option value="1">1 - Very Poor</option>
                    </select>
                </div>

                <div class="form-group">
                    <label for="feedbackCategory">Feedback Category</label>

                    <select id="feedbackCategory" required>
                        <option value="">Select a category</option>
                        <option value="Positive">Positive</option>
                        <option value="Suggestion">Suggestion</option>
                        <option value="Complaint">Complaint</option>
                    </select>
                </div>

                <div class="form-group full-width">
                    <label for="feedbackText">Customer Comment</label>

                    <textarea
                        id="feedbackText"
                        rows="4"
                        placeholder="Enter the customer's feedback..."
                        required></textarea>
                </div>
            </div>

            <div class="form-actions">
                <button
                    type="submit"
                    class="btn-primary"
                    id="feedbackSubmitBtn">
                    Save Feedback
                </button>

                <button
                    type="button"
                    class="btn-secondary"
                    id="refreshFeedbackBtn">
                    Refresh Feedback
                </button>
            </div>

            <p id="feedbackMessage" class="message"></p>
        </form>

        <div class="feedback-list-section">
            <h3>Saved Customer Feedback</h3>
            <div id="feedbackList">
                <p class="muted">Loading feedback...</p>
            </div>
        </div>
    `;

    updateFeedbackStageOptions();
    displayFeedbackEntries();
}

function updateFeedbackStageOptions() {
    const journeySelect = $("feedbackJourney");
    const stageSelect = $("feedbackStage");

    if (!journeySelect || !stageSelect) return;

    const selectedId = journeySelect.value;

    stageSelect.innerHTML = `
        <option value="">Select a stage</option>
    `;

    const journey = journeys.find(
        (item) => String(item.id) === String(selectedId)
    );

    if (!journey) return;

    getFeedbackStageNames(journey).forEach((stageName) => {
        const option = document.createElement("option");

        option.value = stageName;
        option.textContent = stageName;

        stageSelect.appendChild(option);
    });
}

async function loadFeedbackEntries() {
    if (!db) return;

    const list = $("feedbackList");

    if (list) {
        list.innerHTML = `<p class="muted">Loading feedback...</p>`;
    }

    try {
        const { data: userData, error: userError } =
            await db.auth.getUser();

        if (userError || !userData.user) {
            throw new Error("Please sign in to view feedback.");
        }

        const { data, error } = await db
            .from("customer_feedback")
            .select("*")
            .order("created_at", { ascending: false });

        if (error) throw error;

        feedbackEntries = data || [];

        displayFeedbackEntries();
    } catch (error) {
        console.error("Feedback loading failed:", error);

        if (list) {
            list.innerHTML = `
                <p class="message error">
                    ${escapeHTML(error.message)}
                </p>
            `;
        }
    }
}

function displayFeedbackEntries() {
    const list = $("feedbackList");

    if (!list) return;

    if (!feedbackEntries.length) {
        list.innerHTML = `
            <div class="feedback-empty">
                <h4>No feedback yet</h4>
                <p class="muted">Customer feedback you save will appear here.</p>
            </div>
        `;
        return;
    }

    list.innerHTML = feedbackEntries.map((entry) => {
        const journey = journeys.find(
            (item) => String(item.id) === String(entry.journey_id)
        );

        const journeyName = journey
            ? journey.journeyName
            : "Customer Journey";

        const date = entry.created_at
            ? new Date(entry.created_at).toLocaleString()
            : "";

        const categoryClass = String(entry.category || "")
            .toLowerCase()
            .replace(/[^a-z]/g, "");

        const rating = Number(entry.rating) || 0;

        return `
            <article class="feedback-item">
                <div class="feedback-meta">
                    <div>
                        <h4>${escapeHTML(journeyName)}</h4>
                        <p class="muted">
                            Stage: ${escapeHTML(entry.stage_name)}
                        </p>
                    </div>

                    <span class="feedback-category ${escapeHTML(categoryClass)}">
                        ${escapeHTML(entry.category)}
                    </span>
                </div>

                <div class="feedback-rating" aria-label="${rating} out of 5 stars">
                    ${"★".repeat(Math.max(0, Math.min(5, rating)))}${"☆".repeat(Math.max(0, 5 - rating))}
                    <span>${rating}/5</span>
                </div>

                <p>${escapeHTML(entry.feedback_text)}</p>

                <small class="muted">${escapeHTML(date)}</small>

                <div class="feedback-actions">
                    <button
                        type="button"
                        class="btn-danger"
                        data-action="delete-feedback"
                        data-id="${escapeHTML(entry.id)}">
                        Delete Feedback
                    </button>
                </div>
            </article>
        `;
    }).join("");
}

async function submitCustomerFeedback(event) {
    event.preventDefault();

    if (!db) return;

    const journeyId = $("feedbackJourney")?.value;
    const stageName = $("feedbackStage")?.value;
    const feedbackText = $("feedbackText")?.value.trim();
    const rating = Number($("feedbackRating")?.value);
    const category = $("feedbackCategory")?.value;

    const message = $("feedbackMessage");
    const submitButton = $("feedbackSubmitBtn");

    if (!journeyId || !stageName || !feedbackText || !rating || !category) {
        setMessage(
            message,
            "Complete all feedback fields.",
            "error"
        );
        return;
    }

    if (rating < 1 || rating > 5) {
        setMessage(message, "Choose a rating from 1 to 5.", "error");
        return;
    }

    const journey = journeys.find(
        (item) => String(item.id) === String(journeyId)
    );

    if (!journey) {
        setMessage(message, "Select a valid customer journey.", "error");
        return;
    }

    if (submitButton) {
        submitButton.disabled = true;
        submitButton.textContent = "Saving...";
    }

    try {
        const { data: userData, error: userError } =
            await db.auth.getUser();

        if (userError || !userData.user) {
            throw new Error("Please sign in again.");
        }

        const feedbackRecord = {
            user_id: userData.user.id,
            journey_id: String(journey.id),
            stage_name: stageName,
            feedback_text: feedbackText,
            rating,
            category
        };

        const { error } = await db
            .from("customer_feedback")
            .insert(feedbackRecord);

        if (error) throw error;

        setMessage(message, "Customer feedback saved successfully!", "success");

        $("feedbackText").value = "";
        $("feedbackRating").value = "";
        $("feedbackCategory").value = "";

        await loadFeedbackEntries();
    } catch (error) {
        console.error("Saving feedback failed:", error);

        setMessage(
            message,
            "Could not save feedback: " + error.message,
            "error"
        );
    } finally {
        if (submitButton) {
            submitButton.disabled = false;
            submitButton.textContent = "Save Feedback";
        }
    }
}

async function deleteFeedback(id) {
    if (!db || !id) return;

    if (!confirm("Delete this feedback entry?")) return;

    try {
        const { data: userData, error: userError } =
            await db.auth.getUser();

        if (userError || !userData.user) {
            throw new Error("Please sign in again.");
        }

        const { error } = await db
            .from("customer_feedback")
            .delete()
            .eq("id", id)
            .eq("user_id", userData.user.id);

        if (error) throw error;

        feedbackEntries = feedbackEntries.filter(
            (entry) => String(entry.id) !== String(id)
        );

        displayFeedbackEntries();
    } catch (error) {
        alert("Could not delete feedback: " + error.message);
        
    const totalElement = $("feedbackTotalCount");
    const averageElement = $("feedbackAverageRating");
    const positiveElement = $("feedbackPositiveCount");

    if (totalElement) {
        totalElement.textContent = feedbackEntries.length;
    }

    if (averageElement) {
        const ratings = feedbackEntries
            .map((entry) => Number(entry.rating))
            .filter((rating) => rating >= 1 && rating <= 5);

        const average = ratings.length
            ? ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length
            : 0;

        averageElement.textContent = ratings.length
            ? average.toFixed(1) + " / 5"
            : "—";
    }

    if (positiveElement) {
        positiveElement.textContent = feedbackEntries.filter(
            (entry) => entry.category === "Positive"
        ).length;
    }

    }
}

function initializeFeedbackModule() {
    if (feedbackModuleInitialized) return;

    const feedbackContent = $("feedbackContent");

    if (!feedbackContent) return;

    feedbackContent.addEventListener("change", (event) => {
        if (event.target.id === "feedbackJourney") {
            updateFeedbackStageOptions();
        }
    });

    feedbackContent.addEventListener("submit", (event) => {
        if (event.target.id === "feedbackForm") {
            submitCustomerFeedback(event);
        }
    });

    feedbackContent.addEventListener("click", (event) => {
        if (event.target.closest("#refreshFeedbackBtn")) {
            loadFeedbackEntries();
        }

        const deleteButton = event.target.closest(
            '[data-action="delete-feedback"]'
        );

        if (deleteButton) {
            deleteFeedback(deleteButton.dataset.id);
        }
    });

    feedbackModuleInitialized = true;
}

// ==========================================
// 10. EVENT LISTENERS
// ==========================================

function initializeAppEvents() {
    $("authForm")?.addEventListener("submit", handleAuthSubmit);

    $("authToggle")?.addEventListener("click", () => {
        setAuthMode(!isSignUpMode);
    });

    $("signOutBtn")?.addEventListener("click", handleSignOut);

    $("journeyForm")?.addEventListener("submit", createJourney);

    $("createJourneyBtn")?.addEventListener("click", () => {
        showPage("create");
    });

    document.querySelectorAll("[data-page]").forEach((button) => {
        button.addEventListener("click", () => {
            currentJourneyId = null;
            showPage(button.dataset.page);
        });
    });

    document.addEventListener("click", (event) => {
        const actionButton = event.target.closest("[data-action]");

        if (!actionButton) return;

        const action = actionButton.dataset.action;
        const id = actionButton.dataset.id;

        if (action === "create") {
            currentJourneyId = null;
            showPage("create");
        }

        if (action === "view") {
            currentJourneyId = id;
            showPage("journeys");
            renderJourneyDetail(id);
        }

        if (action === "back") {
            currentJourneyId = null;
            showPage("journeys");
        }

        if (action === "delete") {
            deleteJourney(id);
        }

        if (action === "generate-survey") {
            createOrRefreshSurveyLink(id);
        }

        if (action === "refresh-survey-results") {
            loadSurveyAnalytics(id);
        }

        if (action === "copy-survey-link") {
            const input = $("surveyShareUrl");
            if (input) {
                input.select();
                if (navigator.clipboard?.writeText) {
                    navigator.clipboard.writeText(input.value).then(() => {
                        setSaveStatus("Survey link copied.");
                    }).catch(() => {
                        setSaveStatus("Select and copy the survey link from the box.");
                    });
                } else {
                    setSaveStatus("Select and copy the survey link from the box.");
                }
            }
        }

        if (action === "add-stage") {
            const journey = journeys.find(
                (item) => String(item.id) === String(currentJourneyId)
            );

            if (!journey) return;

            journey.stages.push({
                name: `New Stage ${journey.stages.length + 1}`,
                description: "",
                actions: "",
                thoughts: "",
                emotions: "",
                painPoints: "",
                opportunities: ""
            });

            renderJourneyDetail(journey.id);
            scheduleSave(journey);
        }

        if (action === "remove-stage") {
            const journey = journeys.find(
                (item) => String(item.id) === String(currentJourneyId)
            );

            if (!journey) return;

            const index = Number(actionButton.dataset.index);

            if (
                !Number.isInteger(index) ||
                index < 0 ||
                index >= journey.stages.length
            ) {
                return;
            }

            if (!confirm("Remove this journey stage?")) return;

            journey.stages.splice(index, 1);

            renderJourneyDetail(journey.id);
            scheduleSave(journey);
        }
    });

    const journeysPage = $("journeysPage");

    if (journeysPage) {
        journeysPage.addEventListener("input", (event) => {
            const journey = journeys.find(
                (item) => String(item.id) === String(currentJourneyId)
            );

            if (!journey) return;

            const field = event.target.dataset.field;

            if (field) {
                journey[field] = event.target.value;
                scheduleSave(journey);
                return;
            }

            const stageIndex = event.target.dataset.stageIndex;
            const stageField = event.target.dataset.stageField;

            if (
                stageIndex !== undefined &&
                stageField &&
                journey.stages[Number(stageIndex)]
            ) {
                const index = Number(stageIndex);

                if (typeof journey.stages[index] === "string") {
                    journey.stages[index] = {
                        name: journey.stages[index],
                        description: "",
                        actions: "",
                        thoughts: "",
                        emotions: "",
                        painPoints: "",
                        opportunities: ""
                    };
                }

                journey.stages[index][stageField] = event.target.value;
                scheduleSave(journey);
            }
        });
    }
}

// ==========================================
// 11. START APPLICATION
// ==========================================

async function startApp() {
    if (!db) {
        setMessage(
            $("authMessage"),
            "Supabase is not configured. Check supabase-config.js.",
            "error"
        );
        return;
    }

    showSignedIn();
    await loadJourneys();
}

async function initializeApp() {
    const surveyToken = new URLSearchParams(window.location.search).get("survey");
    if (surveyToken) {
        initializePublicSurvey(surveyToken);
        return;
    }

    initializeAppEvents();
    initializeFeedbackModule();

    if (!db) {
        setMessage(
            $("authMessage"),
            "Supabase is not configured. Check supabase-config.js.",
            "error"
        );
        return;
    }

    const { data, error } = await db.auth.getSession();

    if (error) {
        console.error("Session loading failed:", error);
        return;
    }

    if (data.session) {
        await startApp();
    } else {
        if ($("authSection")) {
            $("authSection").classList.remove("hidden");
        }

        if ($("appLayout")) {
            $("appLayout").classList.add("hidden");
        }
    }

    db.auth.onAuthStateChange((event, session) => {
        if (session) {
            showSignedIn();
        } else {
            if ($("appLayout")) {
                $("appLayout").classList.add("hidden");
            }

            if ($("authSection")) {
                $("authSection").classList.remove("hidden");
            }
        }
    });
}

document.addEventListener("DOMContentLoaded", initializeApp);


// ==========================================
// 12. PUBLIC CUSTOMER VOTING + PAIN-POINT ANALYTICS
// ==========================================

function encodeSurveyPayload(value) {
    const bytes = new TextEncoder().encode(JSON.stringify(value));
    let binary = "";
    bytes.forEach((byte) => binary += String.fromCharCode(byte));
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodeSurveyPayload(value) {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
}

function buildSurveyUrl(journey, token) {
    const payload = {
        name: journey.journeyName,
        stages: getFeedbackStageNames(journey).filter(Boolean)
    };
    const url = new URL(window.location.href);
    url.search = "";
    url.hash = "";
    url.searchParams.set("survey", token);
    url.searchParams.set("data", encodeSurveyPayload(payload));
    return url.toString();
}

async function createOrRefreshSurveyLink(journeyId) {
    const journey = journeys.find((item) => String(item.id) === String(journeyId));
    if (!journey || !db) return;
    const area = $("surveyLinkArea");
    if (area) area.innerHTML = '<p class="muted">Preparing your survey link...</p>';
    try {
        const { data: userData, error: userError } = await db.auth.getUser();
        if (userError || !userData.user) throw new Error("Please sign in again.");

        let linkRow;
        const existing = await db.from("journey_survey_links")
            .select("journey_id, survey_token")
            .eq("journey_id", journey.id)
            .maybeSingle();
        if (existing.error) throw existing.error;
        if (existing.data) {
            linkRow = existing.data;
        } else {
            const created = await db.from("journey_survey_links")
                .insert({ journey_id: journey.id, user_id: userData.user.id, survey_token: crypto.randomUUID() })
                .select("journey_id, survey_token")
                .single();
            if (created.error) throw created.error;
            linkRow = created.data;
        }
        displaySurveyLink(journey, linkRow.survey_token);
        await loadSurveyAnalytics(journey.id);
    } catch (error) {
        if (area) area.innerHTML = `<p class="message error">Could not create survey link: ${escapeHTML(error.message)}. Confirm the survey SQL setup has been run.</p>`;
    }
}

async function loadExistingSurveyLink(journeyId) {
    if (!db) return;
    const journey = journeys.find((item) => String(item.id) === String(journeyId));
    if (!journey) return;
    try {
        const { data, error } = await db.from("journey_survey_links")
            .select("journey_id, survey_token")
            .eq("journey_id", journey.id)
            .maybeSingle();
        if (error) throw error;
        if (data) displaySurveyLink(journey, data.survey_token);
        await loadSurveyAnalytics(journey.id);
    } catch (error) {
        console.warn("Survey link is not available yet:", error.message);
    }
}

function displaySurveyLink(journey, token) {
    const area = $("surveyLinkArea");
    if (!area) return;
    const url = buildSurveyUrl(journey, token);
    area.innerHTML = `
        <label for="surveyShareUrl"><strong>Shareable survey URL</strong></label>
        <div class="survey-share-row">
            <input id="surveyShareUrl" type="url" readonly value="${escapeHTML(url)}">
            <button type="button" class="btn-secondary" data-action="copy-survey-link">Copy link</button>
            <a class="btn-secondary survey-open-link" href="${escapeHTML(url)}" target="_blank" rel="noopener">Open survey</a>
        </div>
        <p class="muted">Customers can open this link without signing in. Share it in a message or convert it into a QR code with a QR-code generator.</p>
        <button type="button" class="btn-secondary" data-action="refresh-survey-results" data-id="${escapeHTML(journey.id)}">Refresh results</button>
    `;
}

async function loadSurveyAnalytics(journeyId) {
    const container = $("surveyAnalytics");
    if (!container || !db) return;
    try {
        const { data, error } = await db.from("journey_stage_votes")
            .select("stage_name, difficulty, comment, created_at")
            .eq("journey_id", journeyId);
        if (error) throw error;
        const votes = data || [];
        const journey = journeys.find((item) => String(item.id) === String(journeyId));
        const stageNames = getFeedbackStageNames(journey);
        const stats = stageNames.map((stageName) => {
            const matching = votes.filter((vote) => vote.stage_name === stageName);
            const difficult = matching.filter((vote) => vote.difficulty === "Very difficult" || vote.difficulty === "Somewhat difficult").length;
            return { stageName, total: matching.length, difficult, rate: matching.length ? Math.round(difficult / matching.length * 100) : 0 };
        }).sort((a, b) => b.rate - a.rate || b.difficult - a.difficult || b.total - a.total);
        const totalDifficult = votes.filter((vote) => vote.difficulty !== "Easy").length;
        container.innerHTML = `
            <div class="survey-results-heading"><h3>Customer-voted pain points</h3><span>${votes.length} total vote(s)</span></div>
            ${votes.length ? `
                <p class="muted">Difficulty rate = (Very difficult + Somewhat difficult votes) ÷ votes for that stage. Small samples may change quickly.</p>
                <div class="survey-stage-results">${stats.map((item, index) => `
                    <article class="survey-result-card">
                        <div class="survey-result-top"><strong>${index + 1}. ${escapeHTML(item.stageName)}</strong><b>${item.rate}% difficult</b></div>
                        <div class="survey-meter"><span style="width:${item.rate}%"></span></div>
                        <p>${item.difficult} difficult vote(s) out of ${item.total} vote(s)</p>
                    </article>
                `).join("")}</div>
                <p class="muted">${totalDifficult} vote(s) report some difficulty across all stages.</p>
            ` : '<div class="empty-state"><h3>Waiting for customer votes</h3><p>Share the survey link. Stage rankings will appear after the first response.</p></div>'}
        `;
    } catch (error) {
        container.innerHTML = `<p class="message error">Could not load survey results: ${escapeHTML(error.message)}</p>`;
    }
}

function initializePublicSurvey(token) {
    document.body.innerHTML = `
        <main class="public-survey-page">
            <section class="public-survey-card">
                <a class="brand" href="./"><span class="brand-icon">J</span><span>JourneyCraft</span></a>
                <p class="eyebrow">CUSTOMER EXPERIENCE SURVEY</p>
                <h1 id="publicSurveyTitle">Help improve this experience</h1>
                <p class="muted">This short survey is anonymous and does not require an account. Choose the stage that matches your experience and rate how difficult it felt.</p>
                <form id="publicSurveyForm">
                    <div class="form-group"><label for="publicSurveyStage">Which stage are you rating?</label><select id="publicSurveyStage" required><option value="">Choose a stage</option></select></div>
                    <fieldset class="difficulty-fieldset"><legend>How difficult was this stage?</legend>
                        <label class="difficulty-option"><input type="radio" name="difficulty" value="Very difficult" required><span>😣 Very difficult</span></label>
                        <label class="difficulty-option"><input type="radio" name="difficulty" value="Somewhat difficult" required><span>😕 Somewhat difficult</span></label>
                        <label class="difficulty-option"><input type="radio" name="difficulty" value="Easy" required><span>🙂 Easy</span></label>
                    </fieldset>
                    <div class="form-group"><label for="publicSurveyComment">Comment (optional)</label><textarea id="publicSurveyComment" rows="3" maxlength="1000" placeholder="What made this stage easy or difficult?"></textarea></div>
                    <button class="btn-primary full-button" id="publicSurveySubmit" type="submit">Submit my vote</button>
                    <p id="publicSurveyMessage" class="message" aria-live="polite"></p>
                </form>
            </section>
        </main>`;

    let payload;
    try {
        const dataParam = new URLSearchParams(window.location.search).get("data");
        if (!dataParam) throw new Error("This survey link is incomplete. Ask the owner for a new link.");
        payload = decodeSurveyPayload(dataParam);
        if (!Array.isArray(payload.stages) || !payload.stages.length) throw new Error("This journey has no stages to rate yet.");
        $("publicSurveyTitle").textContent = `Rate your experience: ${payload.name || "Customer journey"}`;
        $("publicSurveyStage").innerHTML = '<option value="">Choose a stage</option>' + payload.stages.map((name) => `<option value="${escapeHTML(name)}">${escapeHTML(name)}</option>`).join("");
    } catch (error) {
        setMessage($("publicSurveyMessage"), error.message, "error");
        $("publicSurveySubmit").disabled = true;
        return;
    }

    $("publicSurveyForm").addEventListener("submit", async (event) => {
        event.preventDefault();
        const submit = $("publicSurveySubmit");
        submit.disabled = true;
        submit.textContent = "Submitting...";
        try {
            const stageName = $("publicSurveyStage").value;
            const difficulty = document.querySelector('input[name="difficulty"]:checked')?.value;
            const comment = $("publicSurveyComment").value.trim();
            const { data, error } = await db.rpc("submit_journey_stage_vote", {
                p_survey_token: token,
                p_stage_name: stageName,
                p_difficulty: difficulty,
                p_comment: comment || null
            });
            if (error) throw error;
            if (data && data.success === false) throw new Error(data.message || "Your vote could not be saved.");
            $("publicSurveyForm").innerHTML = '<div class="survey-thank-you"><span>✓</span><h2>Thank you for your feedback!</h2><p>Your vote helps identify the stages that need improvement.</p></div>';
        } catch (error) {
            setMessage($("publicSurveyMessage"), `Could not submit your vote: ${error.message}`, "error");
            submit.disabled = false;
            submit.textContent = "Submit my vote";
        }
    });
}
