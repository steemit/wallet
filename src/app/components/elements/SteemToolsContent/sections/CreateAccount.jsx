
import React from 'react';
import { connect } from 'react-redux';
import tt from 'counterpart';
import { PrivateKey } from '@steemit/steem-js/lib/auth/ecc';
import { api } from '@steemit/steem-js';
import PdfDownload from 'app/components/elements/PdfDownload';
import ConfirmCreateAccount from 'app/components/elements/SteemToolsContent/sections/ConfirmCreateAccount';
import { FormattedHTMLMessage } from 'app/Translator';

import LoadingIndicator from 'app/components/elements/LoadingIndicator';
import * as transactionActions from 'app/redux/TransactionReducer';
import * as userActions from 'app/redux/UserReducer';
import * as appActions from 'app/redux/AppReducer';
import shouldComponentUpdate from 'app/utils/shouldComponentUpdate';
import { validate_account_name } from 'app/utils/ChainValidation';

function isInvalidErrorValue(value) {
    if (
        value === false ||
        value === 0 ||
        value === null ||
        value === undefined
    ) {
        return true;
    }

    let text = '';

    if (typeof value === 'string') {
        text = value;
    } else if (value instanceof Error) {
        text = value.message || String(value);
    } else {
        try {
            text = String(value);
        } catch (e) {
            return true;
        }
    }

    let normalized = text.trim().toLowerCase();

    if (!normalized) return true;
    if (normalized === '0') return true;
    if (normalized === 'false') return true;
    if (normalized === 'null') return true;
    if (normalized === 'undefined') return true;
    if (normalized.includes('undefined')) return true;

    return false;
}

function normalizeErrorMessage(value, fallback = tt('g.error')) {
    if (isInvalidErrorValue(value)) {
        return fallback;
    }

    if (typeof value === 'string') {
        return value.trim();
    }

    if (value instanceof Error) {
        let msg = (value.message || String(value) || '').trim();
        return isInvalidErrorValue(msg) ? fallback : msg;
    }

    try {
        let msg = String(value).trim();
        return isInvalidErrorValue(msg) ? fallback : msg;
    } catch (e) {
        return fallback;
    }
}

class CreateAccount extends React.Component {
    constructor(props) {
        super(props);
        this.shouldComponentUpdate = shouldComponentUpdate(this, 'CreateAccount');

        this.state = {
            loading: false,
            error: null,

            creator: props.accountname || props.username || '',
            createe: '',

            active_priv: '',
            active_pub: '',
            posting_priv: '',
            posting_pub: '',
            owner_priv: '',
            owner_pub: '',
            memo_priv: '',
            memo_pub: '',

            paymentMode: 'TOKEN',
            hasExported: false,
            acknowledged: false,
            successMessage: null,
            dlPdf: false,

            useMasterPassword: true,
            masterPassword: '',
            nameError: null,
            nameAvailable: null,
            isCheckingName: false,
        };
        this.checkAccountNameTimer = null;
    }

    componentDidMount() {
        this.generateMasterPassword();
    }

    componentDidUpdate(prevProps) {
        if (
            prevProps.username !== this.props.username ||
            prevProps.accountname !== this.props.accountname
        ) {
            let nextUsername = this.props.accountname || this.props.username || '';
            // eslint-disable-next-line react/no-did-update-set-state
            this.setState({ creator: nextUsername });
        }
    }

    componentWillUnmount() {
        if (this.checkAccountNameTimer) {
            clearTimeout(this.checkAccountNameTimer);
        }
        if (this.deriveKeysTimer) {
            clearTimeout(this.deriveKeysTimer);
        }
    }

    onChange = (e) => {
        let name = e.target.name;
        let value = e.target.value;

        if (name.includes('_pub') || name.includes('_priv')) {
            value = value.replace(/\s/g, '');
        }

        this.setState({ [name]: value, successMessage: null, error: null });

        if (name.includes('_pub') || name.includes('_priv') || name === 'createe') {
            this.setState({ hasExported: false, acknowledged: false });
        }
    };

    onPaymentModeChange = (e) => {
        this.setState({ paymentMode: e.target.value });
    };

    onAcknowledgeToggle = (e) => {
        this.setState({ acknowledged: e.target.checked });
    };

    onToggleMasterPassword = (e) => {
        var checked = e.target.checked;
        if (checked) {
            this.setState({
                useMasterPassword: true,
                hasExported: false,
                acknowledged: false,
            });
        } else {
            this.setState({
                useMasterPassword: false,
                masterPassword: '',
                active_priv: '', active_pub: '',
                posting_priv: '', posting_pub: '',
                owner_priv: '', owner_pub: '',
                memo_priv: '', memo_pub: '',
                hasExported: false,
                acknowledged: false,
            });
        }
    };

    onMasterPasswordChange = (e) => {
        var password = e.target.value.replace(/\s/g, '');
        this.setState({ masterPassword: password, hasExported: false, acknowledged: false }, () => {
            if (this.deriveKeysTimer) {
                clearTimeout(this.deriveKeysTimer);
            }
            this.deriveKeysTimer = setTimeout(() => {
                this.deriveKeysFromMaster(password);
            }, 300);
        });
    };

    generateMasterPassword = () => {
        var randomSeed = Date.now() + '-' + Math.random().toString(36).substring(2, 15) + '-' + Math.random().toString(36).substring(2, 15);
        var privateKey = PrivateKey.fromSeed(randomSeed).toWif();
        var generatedWif = 'P' + privateKey;
        this.setState({ masterPassword: generatedWif, hasExported: false, acknowledged: false }, () => {
            if (this.deriveKeysTimer) {
                clearTimeout(this.deriveKeysTimer);
            }
            this.deriveKeysTimer = setTimeout(() => {
                this.deriveKeysFromMaster(generatedWif);
            }, 300);
        });
    };

    deriveKeysFromMaster = (password) => {
        var createe = this.state.createe;
        var nameValidationError = createe ? validate_account_name(createe) : true;

        if (!createe || !password || nameValidationError) {
            this.setState({
                active_priv: '', active_pub: '',
                posting_priv: '', posting_pub: '',
                owner_priv: '', owner_pub: '',
                memo_priv: '', memo_pub: '',
            });
            return;
        }

        try {
            var roles = ['active', 'posting', 'owner', 'memo'];
            var newState = {};
            roles.forEach(function(role) {
                var pk = PrivateKey.fromSeed(createe + role + password);
                newState[role + '_priv'] = pk.toWif();
                newState[role + '_pub'] = pk.toPublicKey().toString();
            });
            this.setState(newState);
        } catch (e) {
            this.setState({ error: String(e.message) });
        }
    };

    onCreateeChange = (e) => {
        var value = e.target.value.replace(/\s/g, '').toLowerCase();
        var nameValidationError = value ? validate_account_name(value) : null;
        this.setState({
            createe: value,
            nameError: nameValidationError,
            nameAvailable: null,
            isCheckingName: false,
            successMessage: null,
            error: null,
            hasExported: false,
            acknowledged: false
        }, () => {
            if (this.state.useMasterPassword && this.state.masterPassword) {
                if (this.deriveKeysTimer) {
                    clearTimeout(this.deriveKeysTimer);
                }
                this.deriveKeysTimer = setTimeout(() => {
                    this.deriveKeysFromMaster(this.state.masterPassword);
                }, 300);
            }
        });

        if (this.checkAccountNameTimer) {
            clearTimeout(this.checkAccountNameTimer);
        }

        if (value && !nameValidationError) {
            this.checkAccountName(value);
        }
    };

    checkAccountName = (username) => {
        this.setState({ nameAvailable: null });
        this.checkAccountNameTimer = setTimeout(() => {
            this.setState({ isCheckingName: true });
            const normalizedUsername = username.trim().toLowerCase();
            api.callAsync('condenser_api.lookup_accounts', [normalizedUsername, 1])
                .then(accounts => {
                    const exists = Array.isArray(accounts) && accounts.length > 0 && String(accounts[0]).toLowerCase() === normalizedUsername;
                    if (this.state.createe === normalizedUsername) {
                        this.setState({
                            nameAvailable: !exists,
                            isCheckingName: false,
                            nameError: exists ? tt('steem_tools.create_account.error_account_exists') : null
                        });
                    }
                })
                .catch(e => {
                    console.error('API Error checking account name:', e);
                    if (this.state.createe === normalizedUsername) {
                        this.setState({ isCheckingName: false });
                    }
                });
        }, 500);
    };

    onExportKeys = () => {
        var st = this.state;

        if (!st.createe) {
            this.setState({ error: tt('steem_tools.create_account.error_no_account_export') });
            return;
        }

        var content = 'Account: ' + st.createe + '\n';
        if (st.useMasterPassword && st.masterPassword) {
            content += 'Master Password: ' + st.masterPassword + '\n';
        }
        content += '\n';

        var roles = [
            { id: 'owner', pub: st.owner_pub, priv: st.owner_priv },
            { id: 'active', pub: st.active_pub, priv: st.active_priv },
            { id: 'posting', pub: st.posting_pub, priv: st.posting_priv },
            { id: 'memo', pub: st.memo_pub, priv: st.memo_priv }
        ];

        roles.forEach(function(role) {
            content += role.id.toUpperCase() + ' KEYS\n';
            if (role.priv) content += 'Private: ' + role.priv + '\n';
            content += 'Public: ' + role.pub + '\n\n';
        });

        var element = document.createElement("a");
        var file = new Blob([content], { type: 'text/plain' });
        element.href = URL.createObjectURL(file);
        element.download = st.createe + '_steem_keys.txt';
        document.body.appendChild(element);
        element.click();
        document.body.removeChild(element);

        this.setState({ hasExported: true, error: null });
    };

    onExportPdf = () => {
        var st = this.state;
        if (!st.createe) {
            this.setState({ error: tt('steem_tools.create_account.error_no_account_export') });
            return;
        }
        this.setState({ dlPdf: true, hasExported: true, error: null });
    };

    resetDlPdf = () => {
        this.setState({ dlPdf: false });
    };

    onCreateAccount = () => {
        var st = this.state;

        if (st.nameError) {
            this.setState({ error: st.nameError });
            return;
        }

        if (!st.creator || !st.createe) {
            this.setState({ error: tt('steem_tools.create_account.error_no_creator') });
            return;
        }

        if (!st.active_pub || !st.posting_pub || !st.owner_pub || !st.memo_pub) {
            this.setState({ error: tt('steem_tools.create_account.error_no_keys') });
            return;
        }

        if (!st.hasExported || !st.acknowledged) {
            this.setState({ error: tt('steem_tools.create_account.error_no_export') });
            return;
        }

        this.setState({ loading: true, error: null, successMessage: null });

        var ownerParams = { weight_threshold: 1, account_auths: [], key_auths: [[st.owner_pub, 1]] };
        var activeParams = { weight_threshold: 1, account_auths: [], key_auths: [[st.active_pub, 1]] };
        var postingParams = { weight_threshold: 1, account_auths: [], key_auths: [[st.posting_pub, 1]] };

        var operationType = st.paymentMode === 'TOKEN' ? 'create_claimed_account' : 'account_create';
        var operationDetails = {
            creator: st.creator,
            new_account_name: st.createe,
            owner: ownerParams,
            active: activeParams,
            posting: postingParams,
            memo_key: st.memo_pub,
            json_metadata: "",
            extensions: [],
        };

        if (st.paymentMode === 'STEEM') {
            operationDetails.fee = this.props.steemPerActRaw;
        }

        var self = this;
        var accountName = st.createe;

        var refreshAndNotify = function() {
            self.props.notifyAction(accountName);
            self.setState({
                loading: false,
                successMessage: tt('steem_tools.create_account.success_created', { account: accountName }),
                createe: '',
                masterPassword: '',
                active_priv: '', active_pub: '',
                posting_priv: '', posting_pub: '',
                owner_priv: '', owner_pub: '',
                memo_priv: '', memo_pub: '',
                hasExported: false, acknowledged: false
            });
        };

        var confirmData = {
            creator: st.creator,
            newAccount: st.createe,
            paymentMode: st.paymentMode,
            fee: st.paymentMode === 'STEEM' ? this.props.steemPerActRaw : '',
        };

        this.props.broadcastCreate(operationType, operationDetails, confirmData, refreshAndNotify, function(err) {
            self.setState({ loading: false, error: String(err) });
        });
    };

    render() {
        var st = this.state;
        var loading = st.loading;
        var rawError = st.error;
        var error = isInvalidErrorValue(rawError)
            ? null
            : normalizeErrorMessage(
                  rawError,
                  tt('g.error')
              );
        var successMessage = st.successMessage;
        var creator = st.creator;
        var createe = st.createe;
        var paymentMode = st.paymentMode;
        var hasExported = st.hasExported;
        var acknowledged = st.acknowledged;
        var useMasterPassword = st.useMasterPassword;
        var masterPassword = st.masterPassword;
        var nameAvailable = st.nameAvailable;
        var isCheckingName = st.isCheckingName;

        var pendingTokens = Number(this.props.pending_claimed_accounts || 0);
        var steemBalance = this.props.balance || '0.000 STEEM';
        var steemFeeRaw = this.props.steemPerActRaw;



        var canCreate = hasExported && acknowledged && !isCheckingName && nameAvailable === true;
        var hasKeys = st.active_pub && st.posting_pub && st.owner_pub && st.memo_pub;

        var rolesData = [
            { id: 'owner', label: tt('steem_tools.create_account.owner_key'), publicVal: st.owner_pub, privateVal: st.owner_priv, pubName: 'owner_pub', privName: 'owner_priv' },
            { id: 'active', label: tt('steem_tools.create_account.active_key'), publicVal: st.active_pub, privateVal: st.active_priv, pubName: 'active_pub', privName: 'active_priv' },
            { id: 'posting', label: tt('steem_tools.create_account.posting_key'), publicVal: st.posting_pub, privateVal: st.posting_priv, pubName: 'posting_pub', privName: 'posting_priv' },
            { id: 'memo', label: tt('steem_tools.create_account.memo_key'), publicVal: st.memo_pub, privateVal: st.memo_priv, pubName: 'memo_pub', privName: 'memo_priv' }
        ];

        return (
            <div>
                <div className="advtools-panel">
                    <div className="row">
                        <h3 className="column">{tt('steem_tools.create_account.panel_title')}</h3>
                    </div>

                    <div>
                        <div className="row">
                            <div className="column small-12">
                                <FormattedHTMLMessage
                                    className="secondary"
                                    id="steem_tools.create_account.description"
                                />
                            </div>
                        </div>
                        <br />
                    </div>

                    <div style={{ marginTop: 14 }}>
                        <div className="row row-column-mobile">
                            <div className="column flex-container-1- flex-mobile-full" style={{ paddingTop: 5 }}>
                                <div className="label-with-tooltip">
                                    <div>{tt('steem_tools.create_account.creator_label')}</div>
                                </div>
                            </div>
                            <div className="column flex-container-2 flex-mobile-full">
                                <div className="input-group" style={{ marginBottom: '1.25rem' }}>
                                    <span className="input-group-label">@</span>
                                    <input
                                        className="input-group-field bold"
                                        type="text"
                                        disabled
                                        value={creator}
                                    />
                                </div>
                            </div>
                        </div>

                        <div className="row row-column-mobile">
                            <div className="column flex-container-1- flex-mobile-full" style={{ paddingTop: 5 }}>
                                <div className="label-with-tooltip">
                                    <div>{tt('steem_tools.create_account.new_account_label')}</div>
                                </div>
                            </div>
                            <div className="column flex-container-2 flex-mobile-full">
                                <div className={`input-group ${st.nameError ? 'advtools-input-group-error' : ''}`} style={{ marginBottom: (st.nameError || (nameAvailable === true && !st.nameError)) ? '0.25rem' : '1.25rem', position: 'relative' }}>
                                    <span className="input-group-label">@</span>
                                    <input
                                        className={'input-group-field bold' + (st.nameError ? ' advtools-input-error' : (nameAvailable ? ' advtools-input-success' : ''))}
                                        type="text"
                                        name="createe"
                                        value={createe}
                                        onChange={this.onCreateeChange}
                                        autoCorrect="off"
                                        autoCapitalize="none"
                                        spellCheck="false"
                                        placeholder={tt('steem_tools.create_account.new_account_placeholder')}
                                    />
                                    {isCheckingName && (
                                        <div style={{ position: 'absolute', right: '12px', top: 0, bottom: 0, display: 'flex', alignItems: 'center', pointerEvents: 'none', opacity: 0.7 }}>
                                            <LoadingIndicator type="circle" />
                                        </div>
                                    )}
                                </div>
                                {st.nameError && (
                                    <div className="advtools-error-hint">
                                        {st.nameError}
                                    </div>
                                )}
                                {nameAvailable === true && !st.nameError && (
                                    <div className="advtools-error-hint" style={{ color: 'var(--accent)' }}>
                                        {tt('steem_tools.create_account.success_account_available')}
                                    </div>
                                )}
                            </div>
                        </div>

                        <div className="row row-column-mobile">
                            <div className="column flex-container-1- flex-mobile-full" style={{ paddingTop: 5 }}>
                                <div className="label-with-tooltip">
                                    <div>{tt('steem_tools.create_account.payment_mode_label')}</div>
                                </div>
                            </div>
                            <div className="column flex-container-2 flex-mobile-full">
                                <div className="input-group" style={{ marginBottom: '1.25rem' }}>
                                    <select
                                        className="input-group-field"
                                        value={paymentMode}
                                        onChange={this.onPaymentModeChange}
                                    >
                                        <option value="TOKEN">
                                            {tt('steem_tools.create_account.payment_act_option', { count: pendingTokens })}
                                        </option>
                                        <option value="STEEM">
                                            {tt('steem_tools.create_account.payment_steem_option', { fee: steemFeeRaw, balance: steemBalance })}
                                        </option>
                                    </select>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div>
                        <div className="row">
                            <div className="column small-12">
                                <span className="secondary">
                                    {tt('steem_tools.create_account.keys_description')}
                                </span>
                            </div>
                        </div>
                        <br />

                        <div className="row" style={{ marginBottom: '1rem' }}>
                            <div className="column toggle_container advtools-master-check">
                                <span>
                                    {tt('steem_tools.create_account.use_master_password')}
                                </span>
                                <label className="switch">
                                    <input
                                        type="checkbox"
                                        checked={useMasterPassword}
                                        onChange={this.onToggleMasterPassword}
                                    />
                                    <span className="slider round" />
                                </label>
                            </div>
                        </div>

                        {useMasterPassword && (
                            <div className="row row-column-mobile">
                                <div className="column flex-container-1-extended flex-mobile-full" style={{ paddingTop: 5 }}>
                                    <div className="label-with-tooltip">
                                        <div>{tt('steem_tools.create_account.master_password_label')}</div>
                                    </div>
                                </div>
                                <div className="column flex-container-2-extended flex-mobile-full">
                                    <div className="input-group row-column-mobile" style={{ marginBottom: '1.25rem' }}>
                                        <input
                                            className="input-group-field bold"
                                            type="text"
                                            value={masterPassword}
                                            onChange={this.onMasterPasswordChange}
                                            autoComplete="off"
                                            placeholder={tt('steem_tools.create_account.master_password_placeholder')}
                                        />
                                        <div className="input-group-button">
                                            <button className="button" id="generate-button" type="button" onClick={this.generateMasterPassword}>
                                                {tt('steem_tools.create_account.generate_btn')}
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}

                        {rolesData.map(function(role) {
                            return (
                                <div className="row" key={role.id}>
                                    <div className="column small-12">
                                        <div style={{ fontWeight: 'bold', marginBottom: 4 }}>{role.label}</div>
                                        <div className={`row-column-mobile ${useMasterPassword ? 'advtools-grid-dynamic-2' : 'advtools-grid-dynamic-1'}`}>
                                            {useMasterPassword && (
                                                <div>
                                                    <input
                                                        type="text"
                                                        className="input-group-field"
                                                        value={role.privateVal}
                                                        disabled
                                                        placeholder={tt('steem_tools.create_account.private_placeholder', { role: role.id.charAt(0).toUpperCase() + role.id.slice(1) })}
                                                    />
                                                </div>
                                            )}
                                            <div>
                                                <input
                                                    type="text"
                                                    className="input-group-field"
                                                    name={role.pubName}
                                                    value={role.publicVal}
                                                    onChange={useMasterPassword ? undefined : this.onChange}
                                                    disabled={useMasterPassword}
                                                    placeholder={tt('steem_tools.create_account.public_placeholder', { role: role.id.charAt(0).toUpperCase() + role.id.slice(1) })}
                                                />
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            );
                        }.bind(this))}

                        {error ? (
                            <div className="row" style={{ marginBottom: '1rem' }}>
                                <div className="column small-12">
                                    <div className="advtools-message-error">{error}</div>
                                </div>
                            </div>
                        ) : null}

                        {successMessage ? (
                            <div className="row" style={{ marginBottom: '1rem' }}>
                                <div className="column small-12">
                                    <div className="advtools-message-success">{successMessage}</div>
                                </div>
                            </div>
                        ) : null}

                        <div className="row" style={{ marginTop: '1rem', marginBottom: '1rem' }}>
                            <div className="column toggle_container advtools-acknowledge-check">
                                <span>
                                    {tt('steem_tools.create_account.acknowledge_warning')}
                                </span>
                                <label className="switch">
                                    <input
                                        type="checkbox"
                                        checked={acknowledged}
                                        onChange={this.onAcknowledgeToggle}
                                        disabled={!hasExported}
                                    />
                                    <span className="slider round" />
                                </label>
                            </div>
                        </div>

                        <div className="row" style={{ marginTop: '1rem' }}>
                            <div className="column small-12">
                                <button
                                    type="button"
                                    className="button advtools-btn-primary"
                                    onClick={this.onCreateAccount}
                                    disabled={!canCreate || !hasKeys || loading}
                                >
                                    {loading ? tt('steem_tools.create_account.creating_btn') : tt('steem_tools.create_account.create_btn')}
                                </button>

                                <button
                                    type="button"
                                    className="button advtools-btn-primary"
                                    onClick={this.onExportKeys}
                                    disabled={!hasKeys}
                                >
                                    {hasExported ? tt('steem_tools.create_account.exported_txt_btn') : tt('steem_tools.create_account.export_txt_btn')}
                                </button>
                                &nbsp;&nbsp;
                                <button
                                    type="button"
                                    className="button advtools-btn-primary"
                                    onClick={this.onExportPdf}
                                    disabled={!hasKeys}
                                >
                                    {hasExported ? tt('steem_tools.create_account.exported_pdf_btn') : tt('steem_tools.create_account.export_pdf_btn')}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>

                <PdfDownload
                    widthInches={8.5}
                    name={createe}
                    password={useMasterPassword ? masterPassword : ''}
                    keys={{
                        postingPrivate: st.posting_priv,
                        postingPublic: st.posting_pub,
                        activePrivate: st.active_priv,
                        activePublic: st.active_pub,
                        ownerPrivate: st.owner_priv,
                        ownerPublic: st.owner_pub,
                        memoPrivate: st.memo_priv,
                        memoPublic: st.memo_pub,
                    }}
                    dlPdf={st.dlPdf}
                    resetDlPdf={this.resetDlPdf}
                />
            </div>
        );
    }
}

export default connect(
    function mapState(state, ownProps) {
        var current =
            state && state.user && state.user.get ? state.user.get('current') : null;
        var username =
            current && current.get && current.get('username') ? current.get('username') : '';

        var account = ownProps.accountname
            ? state.global.getIn(['accounts', ownProps.accountname])
            : username
            ? state.global.getIn(['accounts', username])
            : null;

        var steem_balance = account && account.get && account.get('balance') ? account.get('balance') : '0.000 STEEM';
        var pending_claimed_accounts = account && account.get && account.get('pending_claimed_accounts') ? account.get('pending_claimed_accounts') : 0;

        var DEFAULT_ACCOUNT_CREATION_FEE = '3.000 STEEM';
        var witness_schedule = state.global.get ? state.global.get('witness_schedule') : null;
        var median_props = witness_schedule && witness_schedule.get ? witness_schedule.get('median_props') : null;
        var account_creation_fee = median_props && median_props.get ? median_props.get('account_creation_fee') : null;

        var steemPerActRaw = account_creation_fee && String(account_creation_fee).includes(' ')
                ? String(account_creation_fee)
                : DEFAULT_ACCOUNT_CREATION_FEE;

        return {
            ...ownProps,
            username: username || '',
            balance: steem_balance,
            pending_claimed_accounts: pending_claimed_accounts,
            steemPerActRaw: steemPerActRaw,
        };
    },
    function mapDispatch(dispatch) {
        return {
            broadcastCreate: function(type, operation, confirmData, successCallback, errorCallback) {
                var confirm = function() {
                    return (
                        <ConfirmCreateAccount operation={confirmData} />
                    );
                };
                dispatch(
                    transactionActions.broadcastOperation({
                        type: type,
                        operation: operation,
                        confirm: confirm,
                        successCallback: successCallback,
                        errorCallback: errorCallback,
                    })
                );
            },
            notifyAction: function(accountName) {
                dispatch(
                    appActions.addNotification({
                        key: 'create_acc_' + Date.now(),
                        message: tt('steem_tools.create_account.notify_created', { account: accountName }),
                        dismissAfter: 5000,
                    })
                );
            }
        };
    }
)(CreateAccount);
