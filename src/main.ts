import "./style.css";
const API_URL =
	"https://api.wordpress.org/plugins/info/1.2/?action=query_plugins&request[block]=blocks&request[per_page]=50";
const gridContainer = document.getElementById("block-grid");
const loadingText = document.getElementById("loading");
const modal = document.getElementById("playground-modal");
const iframe = document.getElementById("playground-iframe");
const closeBtn = document.getElementById("close-modal");

if (!gridContainer || !loadingText || !modal || !iframe || !closeBtn) {
	throw new Error("Missing required elements");
}

// Fetch the blocks from WordPress.org
async function fetchBlocks() {
	if (!loadingText) {
		return;
	}
	try {
		const response = await fetch(API_URL);
		const data = await response.json();

		loadingText.style.display = "none";
		renderBlocks(data.plugins);
	} catch (error) {
		loadingText.innerText = "Error loading blocks. Please try again later.";
		console.error("API Fetch Error:", error);
	}
}

// Render the blocks into the HTML grid
function renderBlocks(plugins) {
	plugins.forEach((plugin) => {
		// Some plugins might not have an SVG, fallback to default icon
		const iconUrl =
			plugin.icons["1x"] ||
			plugin.icons["default"] ||
			"https://s.w.org/plugins/geopattern-icon/block-default.svg";

		const card = document.createElement("div");
		card.className = "block-card";

		card.innerHTML = `
                <img src="${iconUrl}" alt="${plugin.name} icon" class="block-icon">
                <h3>${plugin.name}</h3>
                <p><small>By ${plugin.author}</small></p>
            `;

		// Add click event to launch the playground
		card.addEventListener("click", () => openPlayground(plugin.slug));

		gridContainer.appendChild(card);
	});
}

// Generate Blueprint JSON and launch the iframe
function openPlayground(pluginSlug) {
	// Show the modal
	modal.style.display = "block";

	// Define the Blueprint object
	const blueprint = {
		landingPage: "/wp-admin/post-new.php",
		preferredVersions: {
			php: "8.3",
			wp: "latest",
		},
		login: true,
		features: {
			networking: true,
		},
		steps: [],
	};

	// Convert the Blueprint to a Base64 string for the URL fragment
	const blueprintJsonString = JSON.stringify(blueprint);
	const encodedBlueprint = btoa(blueprintJsonString);

	// Set the iframe source with the encoded Blueprint
	const playgroundBaseUrl = "https://playground.wordpress.net/";
	iframe.src = `${playgroundBaseUrl}#${encodedBlueprint}`;
}

// Close modal and reset iframe (to free up memory)
closeBtn.addEventListener("click", () => {
	modal.style.display = "none";
	iframe.src = "";
});

// Initialize the app
fetchBlocks().catch(console.log);
