/*
    ***** BEGIN LICENSE BLOCK *****
    
    Copyright © 2009 Center for History and New Media
                     George Mason University, Fairfax, Virginia, USA
                     http://zotero.org
    
    This file is part of Zotero.
    
    Zotero is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.
    
    Zotero is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.
    
    You should have received a copy of the GNU Affero General Public License
    along with Zotero.  If not, see <http://www.gnu.org/licenses/>.
    
    ***** END LICENSE BLOCK *****
*/


Zotero.Sync.Storage.WebDAV_Module = {};
Zotero.Sync.Storage.WebDAV_Module.prototype = {
	name: "WebDAV",
	get verified() {
		return Zotero.Prefs.get("sync.storage.verified");
	},
	
	_initialized: false,
	_parentURI: null,
	_rootURI: null,	
	_cachedCredentials: false,
	
	_loginManagerHost: 'chrome://zotero',
	_loginManagerURL: 'Zotero Storage Server',
	
	_lastSyncIDLength: 30,
	
	
	get defaultError() {
		return Zotero.getString('sync.storage.error.webdav.default');
	},
	
	get defaultErrorRestart() {
		return Zotero.getString('sync.storage.error.webdav.defaultRestart', Zotero.appName);
	},
	
	get _username() {
		return Zotero.Prefs.get('sync.storage.username');
	},
	
	get _password() {
		var username = this._username;
		
		if (!username) {
			Zotero.debug('Username not set before getting Zotero.Sync.Storage.WebDAV.password');
			return '';
		}
		
		Zotero.debug('Getting WebDAV password');
		var loginManager = Components.classes["@mozilla.org/login-manager;1"]
								.getService(Components.interfaces.nsILoginManager);
		var logins = loginManager.findLogins({}, this._loginManagerHost, this._loginManagerURL, null);
		
		// Find user from returned array of nsILoginInfo objects
		for (var i = 0; i < logins.length; i++) {
			if (logins[i].username == username) {
				return logins[i].password;
			}
		}
		
		return '';
	},
	
	set _password(password) {
		var username = this._username;
		if (!username) {
			Zotero.debug('Username not set before setting Zotero.Sync.Server.Mode.WebDAV.password');
			return;
		}
		
		_cachedCredentials = false;
		
		var loginManager = Components.classes["@mozilla.org/login-manager;1"]
								.getService(Components.interfaces.nsILoginManager);
		var logins = loginManager.findLogins({}, this._loginManagerHost, this._loginManagerURL, null);
		
		for (var i = 0; i < logins.length; i++) {
			Zotero.debug('Clearing WebDAV passwords');
			loginManager.removeLogin(logins[i]);
			break;
		}
		
		if (password) {
			Zotero.debug(this._loginManagerURL);
			var nsLoginInfo = new Components.Constructor("@mozilla.org/login-manager/loginInfo;1",
				Components.interfaces.nsILoginInfo, "init");
			var loginInfo = new nsLoginInfo(this._loginManagerHost, this._loginManagerURL,
				null, username, password, "", "");
			loginManager.addLogin(loginInfo);
		}
	},
	
	get rootURI() {
		if (!this._rootURI) {
			this._init();
		}
		return this._rootURI.clone();
	},
	
	get parentURI() {
		if (!this._parentURI) {
			this._init();
		}
		return this._parentURI.clone();
	},
	
	init: function () {
		this._rootURI = false;
		this._parentURI = false;
		
		var scheme = Zotero.Prefs.get('sync.storage.scheme');
		switch (scheme) {
			case 'http':
			case 'https':
				break;
			
			default:
				throw new Error("Invalid WebDAV scheme '" + scheme + "'");
		}
		
		var url = Zotero.Prefs.get('sync.storage.url');
		if (!url) {
			var msg = "WebDAV URL not provided";
			Zotero.debug(msg);
			throw ({
				message: msg,
				name: "Z_ERROR_NO_URL",
				filename: "webdav.js",
				toString: function () { return this.message; }
			});
		}
		
		url = scheme + '://' + url;
		var dir = "zotero";
		var username = this._username;
		var password = this._password;
		
		if (!username) {
			var msg = "WebDAV username not provided";
			Zotero.debug(msg);
			throw ({
				message: msg,
				name: "Z_ERROR_NO_USERNAME",
				filename: "webdav.js",
				toString: function () { return this.message; }
			});
		}
		
		if (!password) {
			var msg = "WebDAV password not provided";
			Zotero.debug(msg);
			throw ({
				message: msg,
				name: "Z_ERROR_NO_PASSWORD",
				filename: "webdav.js",
				toString: function () { return this.message; }
			});
		}
		
		var ios = Components.classes["@mozilla.org/network/io-service;1"].
					getService(Components.interfaces.nsIIOService);
		var uri = ios.newURI(url, null, null);
		uri.username = encodeURIComponent(username);
		uri.password = encodeURIComponent(password);
		if (!uri.spec.match(/\/$/)) {
			uri.spec += "/";
		}
		this._parentURI = uri;
		
		var uri = uri.clone();
		uri.spec += "zotero/";
		this._rootURI = uri;
	},
	
	
	cacheCredentials: Zotero.Promise.coroutine(function* () {
		if (this._cachedCredentials) {
			Zotero.debug("WebDAV credentials are already cached");
			return;
		}
		
		try {
			var req = Zotero.HTTP.request("OPTIONS", this.rootURI);
			checkResponse(req);
			
			Zotero.debug("Credentials are cached");
			this._cachedCredentials = true;
		}
		catch (e) {
			if (e instanceof Zotero.HTTP.UnexpectedStatusException) {
				let msg = "HTTP " + e.status + " error from WebDAV server "
					+ "for OPTIONS request";
				Zotero.debug(msg, 1);
				Components.utils.reportError(msg);
				throw new Error(Zotero.Sync.Storage.WebDAV.defaultErrorRestart);
			}
			throw e;
		}
	}),
	
	
	clearCachedCredentials: function() {
		this._rootURI = this._parentURI = undefined;
		this._cachedCredentials = false;
	},
	
	/**
	 * Begin download process for individual file
	 *
	 * @param	{Zotero.Sync.Storage.Request}	[request]
	 */
	downloadFile: function (request, requeueCallback) {
		var item = Zotero.Sync.Storage.Utilities.getItemFromRequest(request);
		if (!item) {
			throw new Error("Item '" + request.name + "' not found");
		}
		
		// Retrieve modification time from server to store locally afterwards 
		return getStorageModificationTime(item, request)
			.then(function (mdate) {
				if (!request.isRunning()) {
					Zotero.debug("Download request '" + request.name
						+ "' is no longer running after getting mod time");
					return false;
				}
				
				if (!mdate) {
					Zotero.debug("Remote file not found for item " + Zotero.Items.getLibraryKeyHash(item));
					return false;
				}
				
				var syncModTime = mdate.getTime();
				
				// Skip download if local file exists and matches mod time
				var file = item.getFile();
				if (file && file.exists() && syncModTime == file.lastModifiedTime) {
					Zotero.debug("File mod time matches remote file -- skipping download");
					
					Zotero.DB.beginTransaction();
					var syncState = Zotero.Sync.Storage.getSyncState(item.id);
					var updateItem = syncState != 1;
					Zotero.Sync.Storage.setSyncedModificationTime(item.id, syncModTime, updateItem);
					Zotero.Sync.Storage.setSyncState(item.id, Zotero.Sync.Storage.SYNC_STATE_IN_SYNC);
					Zotero.DB.commitTransaction();
					return {
						localChanges: true, // ?
						remoteChanges: false,
						syncRequired: false
					};
				}
				
				var uri = getItemURI(item);
				var destFile = Zotero.getTempDirectory();
				destFile.append(item.key + '.zip.tmp');
				if (destFile.exists()) {
					destFile.remove(false);
				}
				
				var deferred = Zotero.Promise.defer();
				
				var listener = new Zotero.Sync.Storage.StreamListener(
					{
						onStart: function (request, data) {
							if (data.request.isFinished()) {
								Zotero.debug("Download request " + data.request.name
									+ " stopped before download started -- closing channel");
								request.cancel(0x804b0002); // NS_BINDING_ABORTED
								deferred.resolve(false);
							}
						},
						onProgress: function (a, b, c) {
							request.onProgress(a, b, c)
						},
						onStop: function (request, status, response, data) {
							data.request.setChannel(false);
							
							if (status == 404) {
								var msg = "Remote ZIP file not found for item " + item.key;
								Zotero.debug(msg, 2);
								Components.utils.reportError(msg);
								
								// Delete the orphaned prop file
								deleteStorageFiles([item.key + ".prop"])
								.finally(function (results) {
									deferred.resolve(false);
								})
								.done();
								return;
							}
							else if (status != 200) {
								var msg = "HTTP " + status + " from WebDAV server "
									+ " while downloading file";
								Zotero.debug(msg, 1);
								Components.utils.reportError(msg);
								deferred.reject(Zotero.Sync.Storage.WebDAV.defaultError);
								return;
							}
							
							// Don't try to process if the request has been cancelled
							if (data.request.isFinished()) {
								Zotero.debug("Download request " + data.request.name
									+ " is no longer running after file download");
								deferred.resolve(false);
								return;
							}
							
							Zotero.debug("Finished download of " + destFile.path);
							
							try {
								deferred.resolve(
									Zotero.Sync.Storage.processDownload(
										data, requeueCallback
									)
								);
							}
							catch (e) {
								deferred.reject(e);
							}
						},
						onCancel: function (request, status, data) {
							Zotero.debug("Request cancelled");
							deferred.resolve(false);
						},
						request: request,
						item: item,
						compressed: true,
						syncModTime: syncModTime
					}
				);
				
				// Don't display password in console
				var disp = uri.clone();
				if (disp.password) {
					disp.password = '********';
				}
				Zotero.debug('Saving ' + disp.spec + ' with saveURI()');
				const nsIWBP = Components.interfaces.nsIWebBrowserPersist;
				var wbp = Components
					.classes["@mozilla.org/embedding/browser/nsWebBrowserPersist;1"]
					.createInstance(nsIWBP);
				wbp.persistFlags = nsIWBP.PERSIST_FLAGS_BYPASS_CACHE;
				wbp.progressListener = listener;
				Zotero.Utilities.Internal.saveURI(wbp, uri, destFile);
				
				return deferred.promise;
			});
	},
	
	
	uploadFile: function (request) {
		var deferred = Zotero.Promise.defer();
		var created = Zotero.Sync.Storage.createUploadFile(
			request,
			function (data) {
				if (!data) {
					deferred.resolve(false);
					return;
				}
				deferred.resolve(
					Zotero.Promise.try(function () {
						return processUploadFile(data);
					})
				);
			}
		);
		if (!created) {
			return Zotero.Promise.resolve(false);
		}
		return deferred.promise;
	},
	
	
	getLastSyncTime: function () {
		var lastSyncURI = this.rootURI;
		lastSyncURI.spec += "lastsync.txt";
		
		// Cache the credentials at the root URI
		var self = this;
		return Zotero.Promise.try(function () {
			return self._cacheCredentials();
		})
		.then(function () {
			return Zotero.HTTP.promise("GET", lastSyncURI,
				{ debug: true, successCodes: [200, 300, 404] });
		})
		.then(function (req) {
			// If lastsync exists but not lastsync.txt, some servers try to
			// be helpful and return 300.
			if (req.status == 300 || req.status == 404) {
				Zotero.debug("No last WebDAV sync file");
				
				// If no lastsync.txt, check previously used 'lastsync',
				// and then delete it
				let lastSyncURI = self.rootURI;
				lastSyncURI.spec += "lastsync";
				return Zotero.HTTP.promise("GET", lastSyncURI,
					{ debug: true, successCodes: [200, 404] })
				.then(function (req) {
					if (req.status == 404) {
						return null;
					}
					
					Zotero.HTTP.promise("DELETE", lastSyncURI,
						{ debug: true, successCodes: [200, 204, 404] })
					.done();
					
					var lastModified = req.getResponseHeader("Last-Modified");
					var date = new Date(lastModified);
					Zotero.debug("Last successful WebDAV sync was " + date);
					return Zotero.Date.toUnixTimestamp(date);
				});
			}
			
			var lastModified = req.getResponseHeader("Last-Modified");
			var date = new Date(lastModified);
			Zotero.debug("Last successful WebDAV sync was " + date);
			
			var re = new RegExp("^[a-zA-Z0-9]{" + _lastSyncIDLength + "}$");
			if (!re.test(req.responseText)) {
				Zotero.HTTP.promise("DELETE", lastSyncURI,
					{ debug: true, successCodes: [200, 204, 404] })
				.done();
				
				throw new Error("Invalid last sync id '" + req.responseText+ "'")
			}
			
			return req.responseText;
		})
		.catch(function (e) {
			if (e instanceof Zotero.HTTP.UnexpectedStatusException) {
				if (e.status == 403) {
					Zotero.debug("Clearing WebDAV authentication credentials", 2);
					_cachedCredentials = false;
				}
				else {
					throw("HTTP " + e.status + " error from WebDAV server "
						+ "for GET request");
				}
				
				return Zotero.Promise.reject(e);
			}
			// TODO: handle browser offline exception
			else {
				throw (e);
			}
		});
	},
	
	
	setLastSyncTime: function (libraryID, localLastSyncID) {
		if (libraryID != Zotero.Libraries.userLibraryID) {
			throw new Error("libraryID must be user library");
		}
		
		// DEBUG: is this necessary for WebDAV?
		if (localLastSyncID) {
			var sql = "REPLACE INTO version VALUES (?, ?)";
			Zotero.DB.query(
				sql, ['storage_webdav_' + libraryID, localLastSyncID]
			);
			return;
		}
		
		var uri = this.rootURI;
		var successFileURI = uri.clone();
		successFileURI.spec += "lastsync.txt";
		
		// Generate a random id for the last-sync id
		var id = Zotero.Utilities.randomString(_lastSyncIDLength);
		
		return Zotero.HTTP.promise("PUT", successFileURI,
				{ body: id, debug: true, successCodes: [200, 201, 204] })
		.then(function () {
			var sql = "REPLACE INTO version VALUES (?, ?)";
			Zotero.DB.query(
				sql, ['storage_webdav_' + libraryID, id]
			);
		})
		.catch(function (e) {
			var msg = "HTTP " + e.status + " error from WebDAV server "
				+ "for PUT request";
			Zotero.debug(msg, 2);
			Components.utils.reportError(msg);
			throw Zotero.Sync.Storage.WebDAV.defaultError;
		});
	},
	
	
	
	checkServer: function () {
		var deferred = Zotero.Promise.defer();
		
		try {
			// Clear URIs
			this.init();
			
			var parentURI = this.parentURI;
			var uri = this.rootURI;
		}
		catch (e) {
			switch (e.name) {
				case 'Z_ERROR_NO_URL':
					deferred.resolve([null, Zotero.Sync.Storage.ERROR_NO_URL]);
				
				case 'Z_ERROR_NO_USERNAME':
					deferred.resolve([null, Zotero.Sync.Storage.ERROR_NO_USERNAME]);
				
				case 'Z_ERROR_NO_PASSWORD':
					deferred.resolve([null, Zotero.Sync.Storage.ERROR_NO_PASSWORD]);
					
				default:
					Zotero.debug(e);
					Components.utils.reportError(e);
					deferred.resolve([null, Zotero.Sync.Storage.ERROR_UNKNOWN]);
			}
			
			return deferred.promise;
		}
		
		var xmlstr = "<propfind xmlns='DAV:'><prop>"
			// IIS 5.1 requires at least one property in PROPFIND
			+ "<getcontentlength/>"
			+ "</prop></propfind>";
		
		// Test whether URL is WebDAV-enabled
		var request = Zotero.HTTP.doOptions(uri, function (req) {
			// Timeout
			if (req.status == 0) {
				try {
					checkResponse(req);
				}
				catch (e) {
					deferred.reject(e);
				}
				
				return deferred.resolve([uri, Zotero.Sync.Storage.ERROR_UNREACHABLE]);
			}
			
			Zotero.debug(req.getAllResponseHeaders());
			Zotero.debug(req.responseText);
			Zotero.debug(req.status);
			
			switch (req.status) {
				case 400:
					return deferred.resolve([uri, Zotero.Sync.Storage.ERROR_BAD_REQUEST]);
				
				case 401:
					return deferred.resolve([uri, Zotero.Sync.Storage.ERROR_AUTH_FAILED]);
				
				case 403:
					return deferred.resolve([uri, Zotero.Sync.Storage.ERROR_FORBIDDEN]);
				
				case 500:
					return deferred.resolve([uri, Zotero.Sync.Storage.ERROR_SERVER_ERROR]);
			}
			
			var dav = req.getResponseHeader("DAV");
			if (dav == null) {
				return deferred.resolve([uri, Zotero.Sync.Storage.ERROR_NOT_DAV]);
			}
			
			// Get the Authorization header used in case we need to do a request
			// on the parent below
			var channelAuthorization = Zotero.HTTP.getChannelAuthorization(req.channel);
			
			var headers = { Depth: 0 };
			
			// Test whether Zotero directory exists
			Zotero.HTTP.WebDAV.doProp("PROPFIND", uri, xmlstr, function (req) {
				Zotero.debug(req.responseText);
				Zotero.debug(req.status);
				
				switch (req.status) {
					case 207:
						// Test if missing files return 404s
						var missingFileURI = uri.clone();
						missingFileURI.spec += "nonexistent.prop";
						Zotero.HTTP.promise("GET", missingFileURI, { successCodes: [404], debug: true })
						.then(function () {
							// Test if Zotero directory is writable
							var testFileURI = uri.clone();
							testFileURI.spec += "zotero-test-file.prop";
							Zotero.HTTP.WebDAV.doPut(testFileURI, " ", function (req) {
								Zotero.debug(req.responseText);
								Zotero.debug(req.status);
								
								switch (req.status) {
									case 200:
									case 201:
									case 204:
										Zotero.HTTP.doGet(
											testFileURI,
											function (req) {
												Zotero.debug(req.responseText);
												Zotero.debug(req.status);
												
												switch (req.status) {
													case 200:
														// Delete test file
														Zotero.HTTP.WebDAV.doDelete(
															testFileURI,
															function (req) {
																Zotero.debug(req.responseText);
																Zotero.debug(req.status);
																
																switch (req.status) {
																	case 200: // IIS 5.1 and Sakai return 200
																	case 204:
																		return deferred.resolve([uri, Zotero.Sync.Storage.SUCCESS]);
																	
																	case 401:
																		return deferred.resolve([uri, Zotero.Sync.Storage.ERROR_AUTH_FAILED]);
																	
																	case 403:
																		return deferred.resolve([uri, Zotero.Sync.Storage.ERROR_FORBIDDEN]);
																	
																	default:
																		return deferred.resolve([uri, Zotero.Sync.Storage.ERROR_UNKNOWN]);
																}
															}
														);
														return;
													
													case 401:
														return deferred.resolve([uri, Zotero.Sync.Storage.ERROR_AUTH_FAILED]);
													
													case 403:
														return deferred.resolve([uri, Zotero.Sync.Storage.ERROR_FORBIDDEN]);
													
													// This can happen with cloud storage services
													// backed by S3 or other eventually consistent
													// data stores.
													//
													// This can also be from IIS 6+, which is configured
													// not to serve .prop files.
													// http://support.microsoft.com/kb/326965
													case 404:
														return deferred.resolve([uri, Zotero.Sync.Storage.ERROR_FILE_MISSING_AFTER_UPLOAD]);
													
													case 500:
														return deferred.resolve([uri, Zotero.Sync.Storage.ERROR_SERVER_ERROR]);
													
													default:
														return deferred.resolve([uri, Zotero.Sync.Storage.ERROR_UNKNOWN]);
												}
											}
										);
										return;
									
									case 401:
										return deferred.resolve([uri, Zotero.Sync.Storage.ERROR_AUTH_FAILED]);
									
									case 403:
										return deferred.resolve([uri, Zotero.Sync.Storage.ERROR_FORBIDDEN]);
									
									case 500:
										return deferred.resolve([uri, Zotero.Sync.Storage.ERROR_SERVER_ERROR]);
									
									default:
										return deferred.resolve([uri, Zotero.Sync.Storage.ERROR_UNKNOWN]);
								}
							});
						})
						.catch(function (e) {
							if (e instanceof Zotero.HTTP.UnexpectedStatusException) {
								if (e.status >= 200 && e.status < 300) {
									deferred.resolve([uri, Zotero.Sync.Storage.ERROR_NONEXISTENT_FILE_NOT_MISSING]);
								}
								else if (e.status == 401) {
									deferred.resolve([uri, Zotero.Sync.Storage.ERROR_AUTH_FAILED]);
								}
								else if (e.status == 403) {
									deferred.resolve([uri, Zotero.Sync.Storage.ERROR_FORBIDDEN]);
								}
								else if (e.status == 500) {
									deferred.resolve([uri, Zotero.Sync.Storage.ERROR_SERVER_ERROR]);
								}
								else {
									deferred.resolve([uri, Zotero.Sync.Storage.ERROR_UNKNOWN]);
								}
							}
							else {
								Zotero.debug(e, 1);
								Components.utils.reportError(e);
								deferred.resolve([uri, Zotero.Sync.Storage.ERROR_UNKNOWN]);
							}
						})
						.done();
						return;
					
					case 400:
						return deferred.resolve([uri, Zotero.Sync.Storage.ERROR_BAD_REQUEST]);
					
					case 401:
						return deferred.resolve([uri, Zotero.Sync.Storage.ERROR_AUTH_FAILED]);
					
					case 403:
						return deferred.resolve([uri, Zotero.Sync.Storage.ERROR_FORBIDDEN]);
					
					case 404:
						// Include Authorization header from /zotero request,
						// since Firefox probably won't apply it to the parent request
						var newHeaders = {};
						for (var header in headers) {
							newHeaders[header] = headers[header];
						}
						newHeaders["Authorization"] = channelAuthorization;
						
						// Zotero directory wasn't found, so see if at least
						// the parent directory exists
						Zotero.HTTP.WebDAV.doProp("PROPFIND", parentURI, xmlstr,
							function (req) {
								Zotero.debug(req.responseText);
								Zotero.debug(req.status);
								
								switch (req.status) {
									// Parent directory existed
									case 207:
										return deferred.resolve([uri, Zotero.Sync.Storage.ERROR_ZOTERO_DIR_NOT_FOUND]);
									
									case 400:
										return deferred.resolve([uri, Zotero.Sync.Storage.ERROR_BAD_REQUEST]);
									
									case 401:
										return deferred.resolve([uri, Zotero.Sync.Storage.ERROR_AUTH_FAILED]);
									
									// Parent directory wasn't found either
									case 404:
										return deferred.resolve([uri, Zotero.Sync.Storage.ERROR_PARENT_DIR_NOT_FOUND]);
									
									default:
										return deferred.resolve([uri, Zotero.Sync.Storage.ERROR_UNKNOWN]);
								}
							},  newHeaders);
						return;
					
					case 500:
						return deferred.resolve([uri, Zotero.Sync.Storage.ERROR_SERVER_ERROR]);
						
					default:
						return deferred.resolve([uri, Zotero.Sync.Storage.ERROR_UNKNOWN]);
				}
			}, headers);
		});
		
		if (!request) {
			return deferred.resolve([uri, Zotero.Sync.Storage.ERROR_OFFLINE]);
		}
		
		// Pass XMLHttpRequest to progress handler
		setTimeout(function () {
			var obj = {};
			obj.xmlhttp = request;
			deferred.notify(obj)
		}, 0);
		
		return deferred.promise;
	},
	
	
	/**
	 * Handles the result of WebDAV verification, displaying an alert if necessary.
	 *
	 * @return bool True if the verification succeeded, false otherwise
	 */
	checkServerCallback: function (uri, status, window, skipSuccessMessage) {
		var promptService =
			Components.classes["@mozilla.org/embedcomp/prompt-service;1"].
				createInstance(Components.interfaces.nsIPromptService);
		if (uri) {
			var spec = uri.scheme + '://' + uri.hostPort + uri.path;
		}
		
		switch (status) {
			case Zotero.Sync.Storage.SUCCESS:
				return true;
			
			case Zotero.Sync.Storage.ERROR_NO_URL:
				var errorMessage = Zotero.getString('sync.storage.error.webdav.enterURL');
				break;
			
			case Zotero.Sync.Storage.ERROR_NO_USERNAME:
				var errorMessage = Zotero.getString('sync.error.usernameNotSet');
				break;
			
			case Zotero.Sync.Storage.ERROR_NO_PASSWORD:
				var errorMessage = Zotero.getString('sync.error.enterPassword');
				break;
			
			case Zotero.Sync.Storage.ERROR_UNREACHABLE:
				var errorMessage = Zotero.getString('sync.storage.error.serverCouldNotBeReached', uri.host);
				break;
			
			case Zotero.Sync.Storage.ERROR_NOT_DAV:
				var errorMessage = Zotero.getString('sync.storage.error.webdav.invalidURL', spec);
				break;
			
			case Zotero.Sync.Storage.ERROR_AUTH_FAILED:
				var errorTitle = Zotero.getString('general.permissionDenied');
				var errorMessage = Zotero.localeJoin([
					Zotero.getString('sync.storage.error.webdav.invalidLogin'),
					Zotero.getString('sync.storage.error.checkFileSyncSettings')
				]);
				break;
			
			case Zotero.Sync.Storage.ERROR_FORBIDDEN:
				var errorTitle = Zotero.getString('general.permissionDenied');
				var errorMessage = Zotero.localeJoin([
					Zotero.getString('sync.storage.error.webdav.permissionDenied', uri.path),
					Zotero.getString('sync.storage.error.checkFileSyncSettings')
				]);
				break;
			
			case Zotero.Sync.Storage.ERROR_PARENT_DIR_NOT_FOUND:
				var errorTitle = Zotero.getString('sync.storage.error.directoryNotFound');
				var parentSpec = spec.replace(/\/zotero\/$/, "");
				var errorMessage = Zotero.getString('sync.storage.error.doesNotExist', parentSpec);
				break;
			
			case Zotero.Sync.Storage.ERROR_ZOTERO_DIR_NOT_FOUND:
				var create = promptService.confirmEx(
					window,
					Zotero.getString('sync.storage.error.directoryNotFound'),
					Zotero.getString('sync.storage.error.doesNotExist', spec) + "\n\n"
						+ Zotero.getString('sync.storage.error.createNow'),
					promptService.BUTTON_POS_0
						* promptService.BUTTON_TITLE_IS_STRING
					+ promptService.BUTTON_POS_1
						* promptService.BUTTON_TITLE_CANCEL,
					Zotero.getString('general.create'),
					null, null, null, {}
				);
				
				if (create != 0) {
					return;
				}
				
				createServerDirectory(function (uri, status) {
					switch (status) {
						case Zotero.Sync.Storage.SUCCESS:
							if (!skipSuccessMessage) {
								promptService.alert(
									window,
									Zotero.getString('sync.storage.serverConfigurationVerified'),
									Zotero.getString('sync.storage.fileSyncSetUp')
								);
							}
							Zotero.Prefs.set("sync.storage.verified", true);
							return true;
						
						case Zotero.Sync.Storage.ERROR_FORBIDDEN:
							var errorTitle = Zotero.getString('general.permissionDenied');
							var errorMessage = Zotero.getString('sync.storage.error.permissionDeniedAtAddress') + "\n\n"
								+ spec + "\n\n"
								+ Zotero.getString('sync.storage.error.checkFileSyncSettings');
							break;
					}
					
					// TEMP
					if (!errorMessage) {
						var errorMessage = status;
					}
					promptService.alert(window, errorTitle, errorMessage);
				});
				
				return false;
			
			case Zotero.Sync.Storage.ERROR_FILE_MISSING_AFTER_UPLOAD:
				var errorTitle = Zotero.getString("general.warning");
				var errorMessage = Zotero.getString('sync.storage.error.webdav.fileMissingAfterUpload');
				Zotero.Prefs.set("sync.storage.verified", true);
				break;
			
			case Zotero.Sync.Storage.ERROR_SERVER_ERROR:
				var errorTitle = Zotero.getString('sync.storage.error.webdav.serverConfig.title');
				var errorMessage = Zotero.getString('sync.storage.error.webdav.serverConfig')
					+ "\n\n" + Zotero.getString('sync.storage.error.checkFileSyncSettings');
				break;
			
			case Zotero.Sync.Storage.ERROR_UNKNOWN:
				var errorMessage = Zotero.localeJoin([
					Zotero.getString('general.unknownErrorOccurred'),
					Zotero.getString('sync.storage.error.checkFileSyncSettings')
				]);
				break;
			
			case Zotero.Sync.Storage.ERROR_NONEXISTENT_FILE_NOT_MISSING:
				var errorTitle = Zotero.getString('sync.storage.error.webdav.serverConfig.title');
				var errorMessage = Zotero.getString('sync.storage.error.webdav.nonexistentFileNotMissing');
				break;
		}
		
		if (!skipSuccessMessage) {
			if (!errorTitle) {
				var errorTitle = Zotero.getString("general.error");
			}
			// TEMP
			if (!errorMessage) {
				var errorMessage = status;
			}
			promptService.alert(window, errorTitle, errorMessage);
		}
		return false;
	},
	
	
	/**
	 * Remove files on storage server that were deleted locally
	 *
	 * @param {Integer} libraryID
	 */
	purgeDeletedStorageFiles: Zotero.Promise.coroutine(function* (libraryID) {
		Zotero.debug("Purging deleted storage files");
		var files = yield Zotero.Sync.Storage.Local.getDeletedFiles(libraryID);
		if (!files.length) {
			Zotero.debug("No files to delete remotely");
			return false;
		}
		
		// Add .zip extension
		var files = files.map(file => file + ".zip");
		
		var results = yield deleteStorageFiles(files)
		
		// Remove deleted and nonexistent files from storage delete log
		var toPurge = results.deleted.concat(results.missing);
		if (toPurge.length > 0) {
			yield Zotero.DB.executeTransaction(function* () {
				yield Zotero.Utilities.Internal.forEachChunkAsync(
					toPurge,
					Zotero.DB.MAX_BOUND_PARAMETERS,
					function (chunk) {
						var sql = "DELETE FROM storageDeleteLog WHERE libraryID=? AND key IN ("
							+ chunk.map(() => '?').join() + ")";
						return Zotero.DB.queryAsync(sql, [libraryID].concat(chunk));
					}
				);
			});
		}
		
		Zotero.debug(results);
		
		return results.deleted.length;
	}),
	
	
	/**
	 * Delete orphaned storage files older than a day before last sync time
	 */
	purgeOrphanedStorageFiles: function (libraryID) {
		// Note: libraryID not currently used
		
		return Zotero.Promise.try(function () {
			const daysBeforeSyncTime = 1;
			
			// If recently purged, skip
			var lastpurge = Zotero.Prefs.get('lastWebDAVOrphanPurge');
			var days = 10;
			if (lastpurge && new Date(lastpurge * 1000) > (new Date() - (1000 * 60 * 60 * 24 * days))) {
				return false;
			}
			
			Zotero.debug("Purging orphaned storage files");
			
			var uri = this.rootURI;
			var path = uri.path;
			
			var xmlstr = "<propfind xmlns='DAV:'><prop>"
				+ "<getlastmodified/>"
				+ "</prop></propfind>";
			
			var lastSyncDate = new Date(Zotero.Sync.Server.lastLocalSyncTime * 1000);
			
			var deferred = Zotero.Promise.defer();
			
			Zotero.HTTP.WebDAV.doProp("PROPFIND", uri, xmlstr, function (xmlhttp) {
				Zotero.Promise.try(function () {
					Zotero.debug(xmlhttp.responseText);
					
					var funcName = "Zotero.Sync.Storage.purgeOrphanedStorageFiles()";
					
					var responseNode = xmlhttp.responseXML.documentElement;
					responseNode.xpath = function (path) {
						return Zotero.Utilities.xpath(this, path, { D: 'DAV:' });
					};
					
					var deleteFiles = [];
					var trailingSlash = !!path.match(/\/$/);
					for each(var response in responseNode.xpath("D:response")) {
						var href = Zotero.Utilities.xpathText(
							response, "D:href", { D: 'DAV:' }
						) || "";
						Zotero.debug(href);
						
						// Strip trailing slash if there isn't one on the root path
						if (!trailingSlash) {
							href = href.replace(/\/$/, "");
						}
						
						// Absolute
						if (href.match(/^https?:\/\//)) {
							var ios = Components.classes["@mozilla.org/network/io-service;1"].
										getService(Components.interfaces.nsIIOService);
							var href = ios.newURI(href, null, null);
							href = href.path;
						}
						
						// Skip root URI
						if (href == path
								// Some Apache servers respond with a "/zotero" href
								// even for a "/zotero/" request
								|| (trailingSlash && href + '/' == path)
								// Try URL-encoded as well, as above
								|| decodeURIComponent(href) == path) {
							continue;
						}
						
						if (href.indexOf(path) == -1
								// Try URL-encoded as well, in case there's a '~' or similar
								// character in the URL and the server (e.g., Sakai) is
								// encoding the value
								&& decodeURIComponent(href).indexOf(path) == -1) {
							throw new Error(
								"DAV:href '" + href + "' does not begin with path '"
									+ path + "' in " + funcName
							);
						}
						
						var matches = href.match(/[^\/]+$/);
						if (!matches) {
							throw new Error(
								"Unexpected href '" + href + "' in " + funcName
							);
						}
						var file = matches[0];
						
						if (file.indexOf('.') == 0) {
							Zotero.debug("Skipping hidden file " + file);
							continue;
						}
						if (!file.match(/\.zip$/) && !file.match(/\.prop$/)) {
							Zotero.debug("Skipping file " + file);
							continue;
						}
						
						var key = file.replace(/\.(zip|prop)$/, '');
						var item = Zotero.Items.getByLibraryAndKey(null, key);
						if (item) {
							Zotero.debug("Skipping existing file " + file);
							continue;
						}
						
						Zotero.debug("Checking orphaned file " + file);
						
						// TODO: Parse HTTP date properly
						Zotero.debug(response.innerHTML);
						var lastModified = Zotero.Utilities.xpathText(
							response, ".//D:getlastmodified", { D: 'DAV:' }
						);
						lastModified = Zotero.Date.strToISO(lastModified);
						lastModified = Zotero.Date.sqlToDate(lastModified);
						
						// Delete files older than a day before last sync time
						var days = (lastSyncDate - lastModified) / 1000 / 60 / 60 / 24;
						
						if (days > daysBeforeSyncTime) {
							deleteFiles.push(file);
						}
					}
					
					return deleteStorageFiles(deleteFiles)
					.then(function (results) {
						Zotero.Prefs.set("lastWebDAVOrphanPurge", Math.round(new Date().getTime() / 1000))
						Zotero.debug(results);
					});
				})
				.catch(function (e) {
					deferred.reject(e);
				})
				.then(function () {
					deferred.resolve();
				});
			}, { Depth: 1 });
			
			return deferred.promise;
		}.bind(this));
	},
	
	
	//
	// Private methods
	//
	/**
	 * Get mod time of file on storage server
	 *
	 * @param	{Zotero.Item}	item
	 * @param	{Function}		callback		Callback f(item, mdate)
	 */
	_getStorageModificationTime: function (item, request) {
		var uri = getItemPropertyURI(item);
		
		return Zotero.HTTP.promise("GET", uri,
			{
				debug: true,
				successCodes: [200, 300, 404],
				requestObserver: function (xmlhttp) {
					request.setChannel(xmlhttp.channel);
				}
			})
			.then(function (req) {
				checkResponse(req);
				
				// mod_speling can return 300s for 404s with base name matches
				if (req.status == 404 || req.status == 300) {
					return false;
				}
				
				// No modification time set
				if (!req.responseText) {
					return false;
				}
				
				var seconds = false;
				var parser = Components.classes["@mozilla.org/xmlextras/domparser;1"]
					.createInstance(Components.interfaces.nsIDOMParser);
				try {
					var xml = parser.parseFromString(req.responseText, "text/xml");
					var mtime = xml.getElementsByTagName('mtime')[0].textContent;
				}
				catch (e) {
					Zotero.debug(e);
					var mtime = false;
				}
				
				// TEMP
				if (!mtime) {
					mtime = req.responseText;
					seconds = true;
				}
				
				var invalid = false;
				
				// Unix timestamps need to be converted to ms-based timestamps
				if (seconds) {
					if (mtime.match(/^[0-9]{1,10}$/)) {
						Zotero.debug("Converting Unix timestamp '" + mtime + "' to milliseconds");
						mtime = mtime * 1000;
					}
					else {
						invalid = true;
					}
				}
				else if (!mtime.match(/^[0-9]{1,13}$/)) {
					invalid = true;
				}
				
				// Delete invalid .prop files
				if (invalid) {
					var msg = "Invalid mod date '" + Zotero.Utilities.ellipsize(mtime, 20)
						+ "' for item " + Zotero.Items.getLibraryKeyHash(item);
					Zotero.debug(msg, 1);
					Components.utils.reportError(msg);
					return deleteStorageFiles([item.key + ".prop"])
					.then(function (results) {
						throw new Error(Zotero.Sync.Storage.WebDAV.defaultError);
					});
				}
				
				return new Date(parseInt(mtime));
			})
			.catch(function (e) {
				if (e instanceof Zotero.HTTP.UnexpectedStatusException) {
					throw new Error("HTTP " + e.status + " error from WebDAV "
						+ "server for GET request");
				}
				throw e;
			});
	},
	
	
	/**
	 * Set mod time of file on storage server
	 *
	 * @param	{Zotero.Item}	item
	 */
	_setStorageModificationTime: Zotero.Promise.coroutine(function* (item) {
		var uri = getItemPropertyURI(item);
		
		var mtime = item.attachmentModificationTime;
		var hash = yield item.attachmentHash;
		
		var prop = '<properties version="1">'
			+ '<mtime>' + mtime + '</mtime>'
			+ '<hash>' + hash + '</hash>'
			+ '</properties>';
		
		return Zotero.HTTP.promise("PUT", uri,
				{ body: prop, debug: true, successCodes: [200, 201, 204] })
			.then(function (req) {
				return { mtime: mtime, hash: hash };
			})
			.catch(function (e) {
				throw new Error("HTTP " + e.xmlhttp.status
					+ " from WebDAV server for HTTP PUT");
			})
	}),
	
	
	
	/**
	 * Upload the generated ZIP file to the server
	 *
	 * @param	{Object}		Object with 'request' property
	 * @return	{void}
	 */
	_processUploadFile: Zotero.Promise.coroutine(function* (data) {
		/*
		updateSizeMultiplier(
			(100 - Zotero.Sync.Storage.compressionTracker.ratio) / 100
		);
		*/
		var request = data.request;
		var item = Zotero.Sync.Storage.Utilities.getItemFromRequest(request);
		
		var mdate = getStorageModificationTime(item, request);
		
		if (!request.isRunning()) {
			Zotero.debug("Upload request '" + request.name
				+ "' is no longer running after getting mod time");
			return false;
		}
		
		// Check for conflict
		if (Zotero.Sync.Storage.getSyncState(item.id)
				!= Zotero.Sync.Storage.SYNC_STATE_FORCE_UPLOAD) {
			if (mdate) {
				// Local file time
				var fmtime = yield item.attachmentModificationTime;
				// Remote prop time
				var mtime = mdate.getTime();
				
				var same = !(yield Zotero.Sync.Storage.checkFileModTime(item, fmtime, mtime));
				if (same) {
					Zotero.DB.beginTransaction();
					var syncState = Zotero.Sync.Storage.getSyncState(item.id);
					Zotero.Sync.Storage.setSyncedModificationTime(item.id, fmtime, true);
					Zotero.Sync.Storage.setSyncState(item.id, Zotero.Sync.Storage.SYNC_STATE_IN_SYNC);
					Zotero.DB.commitTransaction();
					return true;
				}
				
				let smtime = Zotero.Sync.Storage.getSyncedModificationTime(item.id);
				if (smtime != mtime) {
					Zotero.debug("Conflict -- last synced file mod time "
						+ "does not match time on storage server"
						+ " (" + smtime + " != " + mtime + ")");
					return {
						localChanges: false,
						remoteChanges: false,
						syncRequired: false,
						conflict: {
							local: { modTime: fmtime },
							remote: { modTime: mtime }
						}
					};
				}
			}
			else {
				Zotero.debug("Remote file not found for item " + item.id);
			}
		}
		
		var file = Zotero.getTempDirectory();
		file.append(item.key + '.zip');
		
		var fis = Components.classes["@mozilla.org/network/file-input-stream;1"]
					.createInstance(Components.interfaces.nsIFileInputStream);
		fis.init(file, 0x01, 0, 0);
		
		var bis = Components.classes["@mozilla.org/network/buffered-input-stream;1"]
					.createInstance(Components.interfaces.nsIBufferedInputStream)
		bis.init(fis, 64 * 1024);
		
		var uri = getItemURI(item);
		
		var ios = Components.classes["@mozilla.org/network/io-service;1"].
					getService(Components.interfaces.nsIIOService);
		var channel = ios.newChannelFromURI(uri);
		channel.QueryInterface(Components.interfaces.nsIUploadChannel);
		channel.setUploadStream(bis, 'application/octet-stream', -1);
		channel.QueryInterface(Components.interfaces.nsIHttpChannel);
		channel.requestMethod = 'PUT';
		channel.allowPipelining = false;
		
		channel.setRequestHeader('Keep-Alive', '', false);
		channel.setRequestHeader('Connection', '', false);
		
		var deferred = Zotero.Promise.defer();
		
		var listener = new Zotero.Sync.Storage.StreamListener(
			{
				onProgress: function (a, b, c) {
					request.onProgress(a, b, c);
				},
				onStop: function (httpRequest, status, response, data) {
					data.request.setChannel(false);
					
					deferred.resolve(
						Zotero.Promise.try(function () {
							return onUploadComplete(httpRequest, status, response, data);
						})
					);
				},
				onCancel: function (httpRequest, status, data) {
					onUploadCancel(httpRequest, status, data);
					deferred.resolve(false);
				},
				request: request,
				item: item,
				streams: [fis, bis]
			}
		);
		channel.notificationCallbacks = listener;
		
		var dispURI = uri.clone();
		if (dispURI.password) {
			dispURI.password = '********';
		}
		Zotero.debug("HTTP PUT of " + file.leafName + " to " + dispURI.spec);
		
		channel.asyncOpen(listener, null);
		
		return deferred.promise;
	}),
	
	
	_onUploadComplete: function (httpRequest, status, response, data) {
		var request = data.request;
		var item = data.item;
		var url = httpRequest.name;
		
		Zotero.debug("Upload of attachment " + item.key
			+ " finished with status code " + status);
		
		switch (status) {
			case 200:
			case 201:
			case 204:
				break;
			
			case 403:
			case 500:
				Zotero.debug(response);
				throw (Zotero.getString('sync.storage.error.fileUploadFailed') +
					" " + Zotero.getString('sync.storage.error.checkFileSyncSettings'));
			
			case 507:
				Zotero.debug(response);
				throw Zotero.getString('sync.storage.error.webdav.insufficientSpace');
			
			default:
				Zotero.debug(response);
				throw (Zotero.getString('sync.storage.error.fileUploadFailed') +
					" " + Zotero.getString('sync.storage.error.checkFileSyncSettings')
					+ "\n\n" + "HTTP " + status);
		}
		
		return setStorageModificationTime(item)
			.then(function (props) {
				if (!request.isRunning()) {
					Zotero.debug("Upload request '" + request.name
						+ "' is no longer running after getting mod time");
					return false;
				}
				
				Zotero.DB.beginTransaction();
				
				Zotero.Sync.Storage.setSyncState(item.id, Zotero.Sync.Storage.SYNC_STATE_IN_SYNC);
				Zotero.Sync.Storage.setSyncedModificationTime(item.id, props.mtime, true);
				Zotero.Sync.Storage.setSyncedHash(item.id, props.hash);
				
				Zotero.DB.commitTransaction();
				
				try {
					var file = Zotero.getTempDirectory();
					file.append(item.key + '.zip');
					file.remove(false);
				}
				catch (e) {
					Components.utils.reportError(e);
				}
				
				return {
					localChanges: true,
					remoteChanges: true,
					syncRequired: true
				};
			});
	},
	
	
	_onUploadCancel: function (httpRequest, status, data) {
		var request = data.request;
		var item = data.item;
		
		Zotero.debug("Upload of attachment " + item.key + " cancelled with status code " + status);
		
		try {
			var file = Zotero.getTempDirectory();
			file.append(item.key + '.zip');
			file.remove(false);
		}
		catch (e) {
			Components.utils.reportError(e);
		}
	},
	
	
	/**
	 * Create a Zotero directory on the storage server
	 */
	_createServerDirectory: function (callback) {
		var uri = Zotero.Sync.Storage.WebDAV.rootURI;
		Zotero.HTTP.WebDAV.doMkCol(uri, function (req) {
			Zotero.debug(req.responseText);
			Zotero.debug(req.status);
			
			switch (req.status) {
				case 201:
					return [uri, Zotero.Sync.Storage.SUCCESS];
				
				case 401:
					return [uri, Zotero.Sync.Storage.ERROR_AUTH_FAILED];
				
				case 403:
					return [uri, Zotero.Sync.Storage.ERROR_FORBIDDEN];
				
				case 405:
					return [uri, Zotero.Sync.Storage.ERROR_NOT_ALLOWED];
				
				case 500:
					return [uri, Zotero.Sync.Storage.ERROR_SERVER_ERROR];
				
				default:
					return [uri, Zotero.Sync.Storage.ERROR_UNKNOWN];
			}
		});
	},
	
	
	/**
	 * Get the storage URI for an item
	 *
	 * @inner
	 * @param	{Zotero.Item}
	 * @return	{nsIURI}					URI of file on storage server
	 */
	_getItemURI: function (item) {
		var uri = Zotero.Sync.Storage.WebDAV.rootURI;
		uri.spec = uri.spec + item.key + '.zip';
		return uri;
	},
	
	
	/**
	 * Get the storage property file URI for an item
	 *
	 * @inner
	 * @param	{Zotero.Item}
	 * @return	{nsIURI}					URI of property file on storage server
	 */
	_getItemPropertyURI: function (item) {
		var uri = Zotero.Sync.Storage.WebDAV.rootURI;
		uri.spec = uri.spec + item.key + '.prop';
		return uri;
	},
	
	
	/**
	 * Get the storage property file URI corresponding to a given item storage URI
	 *
	 * @param	{nsIURI}			Item storage URI
	 * @return	{nsIURI|FALSE}	Property file URI, or FALSE if not an item storage URI
	 */
	_getPropertyURIFromItemURI: function (uri) {
		if (!uri.spec.match(/\.zip$/)) {
			return false;
		}
		var propURI = uri.clone();
		propURI.QueryInterface(Components.interfaces.nsIURL);
		propURI.fileName = uri.fileName.replace(/\.zip$/, '.prop');
		propURI.QueryInterface(Components.interfaces.nsIURI);
		return propURI;
	},
	
	
	/**
	 * @inner
	 * @param	{String[]}	files		Remote filenames to delete (e.g., ZIPs)
	 * @param	{Function}	callback		Passed object containing three arrays:
	 *										'deleted', 'missing', and 'error',
	 *										each containing filenames
	 */
	_deleteStorageFiles: function (files) {
		var results = {
			deleted: [],
			missing: [],
			error: []
		};
		
		if (files.length == 0) {
			return Zotero.Promise.resolve(results);
		}
		
		let deleteURI = _rootURI.clone();
		// This should never happen, but let's be safe
		if (!deleteURI.spec.match(/\/$/)) {
			return Zotero.Promise.reject("Root URI does not end in slash in "
				+ "Zotero.Sync.Storage.WebDAV.deleteStorageFiles()");
		}
		
		var funcs = [];
		for (let i=0; i<files.length; i++) {
			let fileName = files[i];
			let baseName = fileName.match(/^([^\.]+)/)[1];
			funcs.push(function () {
				let deleteURI = _rootURI.clone();
				deleteURI.QueryInterface(Components.interfaces.nsIURL);
				deleteURI.fileName = fileName;
				deleteURI.QueryInterface(Components.interfaces.nsIURI);
				return Zotero.HTTP.promise("DELETE", deleteURI, { successCodes: [200, 204, 404] })
				.then(function (req) {
					switch (req.status) {
						case 204:
						// IIS 5.1 and Sakai return 200
						case 200:
							var fileDeleted = true;
							break;
						
						case 404:
							var fileDeleted = true;
							break;
					}
					
					// If an item file URI, get the property URI
					var deletePropURI = getPropertyURIFromItemURI(deleteURI);
					
					// If we already deleted the prop file, skip it
					if (!deletePropURI || results.deleted.indexOf(deletePropURI.fileName) != -1) {
						if (fileDeleted) {
							results.deleted.push(baseName);
						}
						else {
							results.missing.push(baseName);
						}
						return;
					}
					
					let propFileName = deletePropURI.fileName;
					
					// Delete property file
					return Zotero.HTTP.promise("DELETE", deletePropURI, { successCodes: [200, 204, 404] })
					.then(function (req) {
						switch (req.status) {
							case 204:
							// IIS 5.1 and Sakai return 200
							case 200:
								results.deleted.push(baseName);
								break;
							
							case 404:
								if (fileDeleted) {
									results.deleted.push(baseName);
								}
								else {
									results.missing.push(baseName);
								}
								break;
						}
					});
				})
				.catch(function (e) {
					results.error.push(baseName);
					throw e;
				});
			});
		}
		
		Components.utils.import("resource://zotero/concurrentCaller.js");
		var caller = new ConcurrentCaller(4);
		caller.stopOnError = true;
		caller.setLogger(function (msg) Zotero.debug(msg));
		caller.onError(function (e) Components.utils.reportError(e));
		return caller.fcall(funcs)
		.then(function () {
			return results;
		});
	},
	
	
	/**
	 * Checks for an invalid SSL certificate and throws a nice error
	 */
	_checkResponse: function (req) {
		var channel = req.channel;
		if (!channel instanceof Ci.nsIChannel) {
			Zotero.Sync.Storage.EventManager.error('No HTTPS channel available');
		}
		
		// Check if the error we encountered is really an SSL error
		// Logic borrowed from https://developer.mozilla.org/en-US/docs/How_to_check_the_security_state_of_an_XMLHTTPRequest_over_SSL
		//  http://mxr.mozilla.org/mozilla-central/source/security/nss/lib/ssl/sslerr.h
		//  http://mxr.mozilla.org/mozilla-central/source/security/nss/lib/util/secerr.h
		var secErrLimit = Ci.nsINSSErrorsService.NSS_SEC_ERROR_LIMIT - Ci.nsINSSErrorsService.NSS_SEC_ERROR_BASE;
		var secErr = Math.abs(Ci.nsINSSErrorsService.NSS_SEC_ERROR_BASE) - (channel.status & 0xffff);
		var sslErrLimit = Ci.nsINSSErrorsService.NSS_SSL_ERROR_LIMIT - Ci.nsINSSErrorsService.NSS_SSL_ERROR_BASE;
		var sslErr = Math.abs(Ci.nsINSSErrorsService.NSS_SSL_ERROR_BASE) - (channel.status & 0xffff);
		if( (secErr < 0 || secErr > secErrLimit) && (sslErr < 0 || sslErr > sslErrLimit) ) {
			return;
		}
		
		var secInfo = channel.securityInfo;
		if (secInfo instanceof Ci.nsITransportSecurityInfo) {
			secInfo.QueryInterface(Ci.nsITransportSecurityInfo);
			if ((secInfo.securityState & Ci.nsIWebProgressListener.STATE_IS_INSECURE) == Ci.nsIWebProgressListener.STATE_IS_INSECURE) {
				var host = 'host';
				try {
					host = channel.URI.host;
				}
				catch (e) {
					Zotero.debug(e);
				}
				
				var msg = Zotero.getString('sync.storage.error.webdav.sslCertificateError', host);
				// In Standalone, provide cert_override.txt instructions and a
				// button to open the Zotero profile directory
				if (Zotero.isStandalone) {
					msg += "\n\n" + Zotero.getString('sync.storage.error.webdav.seeCertOverrideDocumentation');
					var buttonText = Zotero.getString('general.openDocumentation');
					var func = function () {
						var zp = Zotero.getActiveZoteroPane();
						zp.loadURI("https://www.zotero.org/support/kb/cert_override", { shiftKey: true });
					};
				}
				// In Firefox display a button to load the WebDAV URL
				else {
					msg += "\n\n" + Zotero.getString('sync.storage.error.webdav.loadURLForMoreInfo');
					var buttonText = Zotero.getString('sync.storage.error.webdav.loadURL');
					var func = function () {
						var zp = Zotero.getActiveZoteroPane();
						zp.loadURI(channel.URI.spec, { shiftKey: true });
					};
				}
				
				var e = new Zotero.Error(
					msg,
					0,
					{
						dialogText: msg,
						dialogButtonText: buttonText,
						dialogButtonCallback: func
					}
				);
				throw e;
			}
			else if ((secInfo.securityState & Ci.nsIWebProgressListener.STATE_IS_BROKEN) == Ci.nsIWebProgressListener.STATE_IS_BROKEN) {
				var msg = Zotero.getString('sync.storage.error.webdav.sslConnectionError', host) +
							Zotero.getString('sync.storage.error.webdav.loadURLForMoreInfo');
				var e = new Zotero.Error(
					msg,
					0,
					{
						dialogText: msg,
						dialogButtonText: Zotero.getString('sync.storage.error.webdav.loadURL'),
						dialogButtonCallback: function () {
							var zp = Zotero.getActiveZoteroPane();
							zp.loadURI(channel.URI.spec, { shiftKey: true });
						}
					}
				);
				throw e;
			}
		}
	}
}
