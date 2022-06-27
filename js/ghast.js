'use strict';

const Page = {
	listing: 0,
	addrepo: 1,
};

const Status = {
	unknown: 0,
	success: 1,
	failed: 2,
	inprogress: 3,
};

const LogComponent = {
	props: ['messages'],
	emits: ['clear'],
	template: `
		<ul class="log" v-for="message, idx in messages">
			<li
				class="log__item"
				:class="{
					log__item_success: message.type === 'success',
					log__item_failure: message.type === 'failure',
				}"
				@click="$emit('clear', message.id)"
			>
				<span class="log__text">
					{{ message.text }}
				</span>
			</li>
		</ul>
	`,
};

function reviver(key, value) {
	const dateRe = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2}).*/;

	if (typeof value === 'string' && dateRe.exec(value)) {
		return new Date(value);
	}

	return value;
}

async function fetchGitHubApi(path) {
	const api = 'https://api.github.com';
	const response = await fetch(api + path);
	if (!response.ok) {
		throw new Error('HTTP error ' + response.status);
	}
	console.log('X-RateLimit-Remaining: ' + response.headers.get('X-RateLimit-Remaining'));
	return await response.json();
}

function getRunStatus(run) {
	if (run.status === 'completed') {
		if (run.conclusion === 'success') {
			return Status.success;
		} else if (run.conclusion === 'failure') {
			return Status.failure;
		}
	} else if (run.status === 'queued' || run.status === 'in_progress') {
		return Status.inprogress;
	}
	console.log('unknown run status ' + run.status + ' ' + run.conclusion);
	return Status.unknown;
}

function getRepositorySortingKey(repository) {
	if (repository.status) {
		if (repository.status.runUpdatedDate) {
			return repository.status.runUpdatedDate.getTime();
		}
		if (repository.status.runStartedDate) {
			return repository.status.runStartedDate.getTime();
		}
		if (repository.status.runCreatedDate) {
			return repository.status.runCreatedDate.getTime();
		}
	}
	return 0;
}

function formatAge(date) {
	const age = new Date() - new Date(date);

	const minutes = age / 1000 / 60;
	if (minutes < 1) {
		return 'just now';
	} else if (minutes < 2) {
		return 'a minute ago';
	} else if (minutes < 60) {
		return Math.floor(minutes) + ' min ago';
	}
	const hours = minutes / 60;
	if (hours < 2) {
		return 'an hour ago';
	} else if (hours < 24) {
		return Math.floor(hours) + ' hrs ago';
	}
	const days = hours / 24;
	if (days < 2) {
		return 'a day ago';
	} else if (days < 365) {
		return Math.floor(days) + ' days ago';
	}
	const years = days / 365;
	if (years < 2) {
		return 'a year ago';
	}
	return Math.floor(years) + ' years ago';
}

function formatDuration(milliseconds) {
	let seconds = Math.floor(milliseconds / 1000);
	if (seconds < 60) {
		return Math.floor(seconds) + 's';
	}
	let minutes = Math.floor(seconds / 60);
	seconds = seconds % 60;
	if (minutes < 60) {
		return minutes + 'm ' + seconds + 's';
	}
	const hours = Math.floor(minutes / 60);
	minutes = minutes % 60;
	return hours + 'h ' + minutes + 'm ' + seconds + 's';
}

const RepositoryComponent = {
	data() {
		return {
			confirmRemove: false,
			flash: false,
		};
	},
	emits: ['update', 'remove'],
	methods: {
		remove() {
			if (this.confirmRemove) {
				this.$emit('remove');
			} else {
				this.confirmRemove = true;
			}
		},
		cancelRemove() {
			this.confirmRemove = false;
		},
	},
	props: ['repository', 'debug'],
	watch: {
		repository: {
			handler(newRepository, oldRepository) {
				const oldUpdateDate = oldRepository.status ? oldRepository.status.runUpdatedDate : undefined;
				const newUpdateDate = newRepository.status ? newRepository.status.runUpdatedDate : undefined;

				if (oldUpdateDate !== newUpdateDate) {
					this.flash = true;
					setTimeout(() => {
						this.flash = false;
					}, 1000)
				}
			},
			deep: true,
		},
	},
	template: `
		<div
			class="repository"
			:class="{
				repository_success: repository.status && repository.status.status === $Status.success,
				repository_failure: repository.status && repository.status.status === $Status.failure,
				repository_inprogress: repository.status && repository.status.status === $Status.inprogress,
				'repository_flash-success': flash && repository.status && repository.status.status === $Status.success,
				'repository_flash-failure': flash && repository.status && repository.status.status === $Status.failure,
				'repository_flash-inprogress': flash && repository.status && repository.status.status === $Status.inprogress,
			}"
		>
			<div class="repository__header">
				<h2
					class="repository__title"
					:class="{
						repository__title_success: repository.status && repository.status.status === $Status.success,
						repository__title_failure: repository.status && repository.status.status === $Status.failure,
						repository__title_inprogress: repository.status && repository.status.status === $Status.inprogress,
					}"
				>
					<a :href="'https://github.com/' + repository.name">{{ repository.name }}</a>
				</h2>
				<div class="repository-controls">
					<button class="repository-controls__button fa fa-arrows-rotate" @click="$emit('update')"></button>
					<div v-if="confirmRemove" class="repository-controls__popup repository-controls__popup_danger">
						<span>Remove?</span>
						<button class="repository-controls__button fa fa-trash-can" @click="remove"></button>
						<button class="repository-controls__button fa fa-xmark" @click="cancelRemove"></button>
					</div>
					<button v-else class="repository-controls__button fa fa-trash-can" v-if="!confirmRemove" @click="remove"></button>
				</div>
			</div>
			<div v-if="repository.status && repository.status.commitMessage">
				<a
					v-if="repository.status.runId"
					:href="'https://github.com/' + repository.name + '/actions/runs/' + repository.status.runId"
				>
					{{ repository.status.commitMessage }}
				</a>
				<span v-else>{{ repository.status.commitMessage }}</span>
			</div>
			<div class="repository-details repository-details_main" v-if="repository.status">
				<div class="repository-details__item">
					{{ $formatAge(repository.status.commitDate) }} by 
					<a v-if="repository.status.user" :href="'https://github.com/' + repository.status.user">{{ repository.status.user }}</a>
					<span v-else>{{ repository.status.commitAuthor }}</span>
				</div>
				<div class="repository-details__item">
					<span class="fa fa-code-branch"></span>&thinsp;
					<a :href="'https://github.com/' + repository.name + '/tree/' + repository.status.branch">
						{{ repository.status.branch }}
					</a>&thinsp;
					<span class="fa fa-code-commit"></span>&thinsp;
					<a :href="'https://github.com/' + repository.name + '/commit/' + repository.status.commitHash">
						{{ repository.status.commitHash.substr(0,7) }}
					</a>
				</div>
				<div class="repository-details__item">
					{{ $formatAge(repository.status.runUpdatedDate) }} in
					{{
						$formatDuration(
							repository.status.runUpdatedDate - (repository.status.runStartedDate || repository.status.runCreatedDate)
						)
					}}

				</div>
			</div>
			<div class="repository-details" v-if="debug">
				<pre class="repository-details__item">{{ JSON.stringify(repository, null, ' ') }}</pre>
			</div>
		</div>
	`,
};

const RepositoriesListingComponent = {
	props: ['repositories', 'debug'],
	emits: ['update', 'remove'],
	template: `
		<div class="repositories">
			<Repository
				v-for="repository in repositories"
				:key="repository.name"
				:repository="repository"
				:debug="debug"
				@update="$emit('update', repository.name)"
				@remove="$emit('remove', repository.name)"
			/>
			<div v-if="debug" class="extra-repositories-panel">
				<p>Listing of added repositories:</p>
				<ul>
					<li v-for="repository in repositories">{{ repository.name }}</li>
				</ul>
			</div>
		</div>
	`,
	components: {
		Repository: RepositoryComponent,
	},
};

const NewRepositoryFormComponent = {
	data() {
		return {
			form: {
				names: '',
			},
		};
	},
	emits: ['add', 'cancel'],
	template: `
		<form class="vertical-form">
			<label for="names">Repositories list in <code>User/Repo</code> form, separated by any whitespace</label>
			<textarea id="names" name="names" v-model="form.names" rows="10"></textarea>
			<button class="form-button form-button_primary" type="submit" @click="$emit('add', form.names)">Add</button>
			<button class="form-button form-button_secondary" type="reset" @click="$emit('cancel')">Cancel</button>
		</form>
	`,
};

const GhastApp = {
	data() {
		return {
			page: Page.listing,
			messages: [],
			nextMessageId: 0,
			repositories: [],
			repositoriesByName: {},
			debug: false,
		};
	},
	components: {
		RepositoriesListing: RepositoriesListingComponent,
		NewRepositoryForm: NewRepositoryFormComponent,
		Log: LogComponent,
	},
	methods: {
		addRepositories(names) {
			names.trim().split(/\s+/).forEach((name) => {
				if (name in this.repositoriesByName) {
					this.addMessage('Repository ' + name + ' already exists', 'error');
				} else {
					const repository = {
						name,
					};
					this.repositories.push(repository);
					this.repositoriesByName[repository.name] = repository;
					this.scheduleNextRepositoryUpdate(repository);
					this.saveState();
					this.addMessage('Repository ' + name + ' added', 'success');
				}
			});
		},
		addMessage(text, type) {
			const id = this.nextMessageId++;
			if (!this.debug) {
				if (type === 'success') {
					setTimeout(() => {
						this.clearMessage(id);
					}, 2000);
				} else {
					setTimeout(() => {
						this.clearMessage(id);
					}, 5000);
				}
			}
			this.messages.push({text, type, id});
		},
		clearMessage(id) {
			for (const idx in this.messages) {
				if (this.messages[idx].id === id) {
					this.messages.splice(idx, 1);
				}
			}
		},
		saveState() {
			localStorage.setItem('repositories', JSON.stringify(this.repositories));
			localStorage.setItem('debug', this.debug);
		},
		removeRepository(name) {
			for (const idx in this.repositories) {
				if (this.repositories[idx].name === name) {
					this.repositories.splice(idx, 1);
					delete this.repositoriesByName[name];
					this.saveState();
					return;
				}
			}
		},
		async updateRepository(name) {
			if (!(name in this.repositoriesByName)) {
				return;
			}

			const repository = this.repositoriesByName[name];

			try {
				repository.lastUpdateAttemptDate = new Date();

				const runsData = await fetchGitHubApi('/repos/' + name + '/actions/runs?exclude_pull_requests=1');

				for (const runIdx in runsData.workflow_runs) {
					const run = runsData.workflow_runs[runIdx];

					if (run.event !== 'push') {
						continue;
					}

					const newStatus = {
						branch: run.head_branch,
						commitHash: run.head_commit.id,
						commitMessage: run.head_commit.message.split('\n')[0],
						commitDate: new Date(run.head_commit.timestamp),
						commitAuthor: run.head_commit.author.name,
						runCreatedDate: new Date(run.created_at),
						runStartedDate: new Date(run.run_started_at),
						runUpdatedDate: new Date(run.updated_at),
						runId: run.id,
						runNumber: run.run_number,
						status: getRunStatus(run),
					};

					if (run.actor.type === 'User') {
						newStatus.user = run.actor.login;
					}

					repository.status = newStatus;

					repository.lastUpdatedDate = new Date();

					break;
				}
			} catch (error) {
				this.addMessage('updating repository failed' + error, 'error');
			}

			this.scheduleNextRepositoryUpdate(repository);

			this.repositories.sort((a, b) => {
				const keyA = getRepositorySortingKey(a);
				const keyB = getRepositorySortingKey(b);

				if (keyA < keyB) {
					return 1;
				} if (keyA > keyB) {
					return -1;
				} else {
					return 0;
				}
			});

			this.saveState();
		},
		scheduleNextRepositoryUpdate(repository) {
			if (repository.timer) {
				clearTimeout(repository.timer);
			}

			// Note: GH sets 60 seconds cache age, so it does not make
			// much sense to repeatedly update more frequently than that

			// default for repositories not changed recently:
			// fetch once an hour, add some random to avoid bursts
			let timeout = 60 * 60 * 1000 * (0.9 + Math.random() * 0.1);
			if (!repository.lastUpdateAttemptDate) {
				// new repositories: update right away
				timeout = 0;
			} else if (repository.status && repository.status.status === Status.inprogress) {
				// building repositories: update every minute
				timeout = 60 * 1000;
			} else if (repository.status && repository.status.runUpdatedDate && new Date() - repository.status.runUpdatedDate < 7 * 24 * 60 * 60 * 1000) {
				// repositories changed recently: update every 5 minutes
				timeout = 5 * 60 * 1000;
			}

			if (repository.lastUpdatedDate) {
				const alreadyPassed = new Date() - repository.lastUpdatedDate;
				timeout = Math.max(timeout - alreadyPassed, 0);
			}

			repository.timer = setTimeout(() => {
				this.updateRepository(repository.name);
			}, timeout);
			repository.nextUpdateDate = new Date(Date.now() + timeout);
		},
	},
	beforeMount() {
		this.debug = localStorage.getItem('debug') === 'true';

		let hadErrors = false;
		try {
			const repositoriesJson = localStorage.getItem('repositories');
			if (typeof repositoriesJson !== 'string') {
				return;
			}
			const repositories = JSON.parse(repositoriesJson, reviver);
			repositories.forEach((repository) => {
				if ('name' in repository) {
					repository.timer = undefined;
					repository.nextUpdateDate = undefined;
					this.repositories.push(repository);
					this.repositoriesByName[repository.name] = repository;
					this.scheduleNextRepositoryUpdate(repository);
				} else {
					hadErrors = true;
				}
			});
		} catch (error) {
			this.addMessage('loading repositories failed' + error, 'error');
			return;
		}

		if (hadErrors) {
			if (this.repositories.length) {
				this.addMessage('loading some repositories failed', 'error');
			} else {
				this.addMessage('loading repositories failed', 'error');
			}
		}
	},
	template: `
		<Log
			v-if="messages.length"
			:messages="messages"
			@clear="clearMessage"
		/>
		<RepositoriesListing
			v-if="page === $Page.listing"
			:repositories="repositories"
			:debug="debug"
			@remove="removeRepository"
			@update="updateRepository"
		/>
		<NewRepositoryForm
			v-if="page === $Page.newrepo"
			@add="(names) => {addRepositories(names); page = $Page.listing}"
			@cancel="page = $Page.listing"
		/>
		<div v-if="page === $Page.listing" class="global-controls">
			<button class="global-button fa fa-wrench" @click="debug = !debug; saveState()"></button>
			<button class="global-button fa fa-plus" @click="page = $Page.newrepo"></button>
		</div>
	`,
};

const app = Vue.createApp(GhastApp); // eslint-disable-line no-undef
app.config.globalProperties.$Page = Page;
app.config.globalProperties.$Status = Status;
app.config.globalProperties.$formatAge = formatAge;
app.config.globalProperties.$formatDuration = formatDuration;
app.mount('#app');
