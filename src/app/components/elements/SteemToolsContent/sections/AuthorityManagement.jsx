import React from 'react';
import { Link } from 'react-router';
import { connect } from 'react-redux';
import tt from 'counterpart';
import { api } from '@steemit/steem-js';
import { FormattedHTMLMessage } from 'app/Translator';
import LoadingIndicator from 'app/components/elements/LoadingIndicator';
import ConfirmAuthorityManagement from 'app/components/elements/ConfirmAuthorityManagement';
import AuthorityManagementSmallTable from './AuthorityManagementSmallTable';
import { validate_account_name } from 'app/utils/ChainValidation';
import * as transactionActions from 'app/redux/TransactionReducer';
import * as appActions from 'app/redux/AppReducer';
import * as globalActions from 'app/redux/GlobalReducer';
import * as userActions from 'app/redux/UserReducer';

const AUTHORITY_TYPES = ['owner', 'active', 'posting'];
const MAX_AUTHORITY_WEIGHT = 65535;

function getFieldValue(source, key, fallback = undefined) {
    if (!source) return fallback;
    if (typeof source.get === 'function') {
        const value = source.get(key);
        return value === undefined ? fallback : value;
    }
    if (Object.prototype.hasOwnProperty.call(source, key)) {
        const value = source[key];
        return value === undefined ? fallback : value;
    }
    return fallback;
}

function toJSValue(value) {
    if (!value) return value;
    if (typeof value.toJS === 'function') return value.toJS();
    return value;
}

function normalizeAuthority(authority) {
    const raw = toJSValue(authority) || {};
    return {
        weight_threshold: Number(raw.weight_threshold || 1),
        account_auths: Array.isArray(raw.account_auths)
            ? raw.account_auths.map((item) => [item[0], Number(item[1])])
            : [],
        key_auths: Array.isArray(raw.key_auths)
            ? raw.key_auths.map((item) => [item[0], Number(item[1])])
            : [],
    };
}

function sanitizeAccountInput(value) {
    return String(value || '').replace(/\s/g, '').toLowerCase();
}

function sanitizeIntegerInput(value) {
    return String(value == null ? '' : value).replace(/[^\d]/g, '');
}

function preventInvalidNumberKeys(e) {
    if (['e', 'E', '+', '-', '.', ',', ' '].includes(e.key)) {
        e.preventDefault();
    }
}

class AuthorityManagement extends React.Component {
    constructor(props) {
        super(props);

        this.state = {
            authorityType: 'posting',
            targetAuthorityAccount: '',
            weight: '1',
            weightThreshold: '1',
            loading: false,
            error: null,
            success: null,
            nameError: null,
            nameAvailable: null,
            isCheckingName: false,
            optimisticAuthorities: {},
            acknowledged: false,
        };

        this.checkAccountNameTimer = null;

        this.onChange = this.onChange.bind(this);
        this.onAuthorityTypeChange = this.onAuthorityTypeChange.bind(this);
        this.onAddAuthority = this.onAddAuthority.bind(this);
        this.onRemoveAllAuthorities = this.onRemoveAllAuthorities.bind(this);
        this.onRemoveSingleAuthority = this.onRemoveSingleAuthority.bind(this);
        this.onFailure = this.onFailure.bind(this);
        this.onSuccess = this.onSuccess.bind(this);
        this.checkAccountName = this.checkAccountName.bind(this);
        this.logAuthoritiesSnapshot = this.logAuthoritiesSnapshot.bind(this);
        this.onAcknowledgeToggle = this.onAcknowledgeToggle.bind(this);
    }

    componentDidMount() {
        this.syncThresholdFromProps(this.state.authorityType, this.props);
        this.logAuthoritiesSnapshot(this.props);
    }

    componentDidUpdate(prevProps, prevState) {
        if (
            prevState.authorityType !== this.state.authorityType ||
            prevProps.account !== this.props.account
        ) {
            this.syncThresholdFromProps(this.state.authorityType, this.props);
        }

        if (prevProps.account !== this.props.account) {
            this.logAuthoritiesSnapshot(this.props);
        }
    }

    componentWillUnmount() {
        if (this.checkAccountNameTimer) {
            clearTimeout(this.checkAccountNameTimer);
        }
    }

    logAuthoritiesSnapshot(props = this.props) {
        const snapshot = AUTHORITY_TYPES.reduce((acc, type) => {
            acc[type] = this.getSelectedAuthority(type, props);
            return acc;
        }, {});
    }

    getSelectedAuthority(authorityType = this.state.authorityType, props = this.props) {
        const { account } = props;
        const { optimisticAuthorities } = this.state;

        if (optimisticAuthorities && optimisticAuthorities[authorityType]) {
            return normalizeAuthority(optimisticAuthorities[authorityType]);
        }

        if (!account) {
            return normalizeAuthority(null);
        }
        return normalizeAuthority(getFieldValue(account, authorityType, null));
    }

    getAuthorityRows(props = this.props) {
        return AUTHORITY_TYPES.flatMap((type) => {
            const authority = this.getSelectedAuthority(type, props);
            return authority.account_auths.map(([name, accountWeight]) => ({
                type,
                name,
                weight: accountWeight,
            }));
        });
    }

    syncThresholdFromProps(authorityType, props = this.props) {
        const authority = this.getSelectedAuthority(authorityType, props);
        const nextThreshold = String(authority.weight_threshold || 1);
        if (this.state.weightThreshold !== nextThreshold) {
            this.setState({ weightThreshold: nextThreshold });
        }
    }

    onChange(e) {
        const { name, value } = e.target;

        if (name === 'targetAuthorityAccount') {
            const sanitizedValue = sanitizeAccountInput(value);
            const nameValidationError = sanitizedValue
                ? validate_account_name(sanitizedValue)
                : null;

            this.setState({
                targetAuthorityAccount: sanitizedValue,
                nameError: nameValidationError,
                nameAvailable: null,
                isCheckingName: false,
                error: null,
                success: null,
            });

            if (this.checkAccountNameTimer) {
                clearTimeout(this.checkAccountNameTimer);
            }

            if (sanitizedValue && !nameValidationError) {
                this.checkAccountName(sanitizedValue);
            }

            return;
        }

        if (name === 'weight' || name === 'weightThreshold') {
            const sanitizedValue = sanitizeIntegerInput(value);
            this.setState({
                [name]: sanitizedValue,
                error: null,
                success: null,
            });
            return;
        }

        this.setState({
            [name]: value,
            error: null,
            success: null,
        });
    }

    onAuthorityTypeChange(e) {
        const authorityType = e.target.value;
        const authority = this.getSelectedAuthority(authorityType);
        this.setState({
            authorityType,
            weightThreshold: String(authority.weight_threshold || 1),
            error: null,
            success: null,
        });
    }

    checkAccountName(username) {
        this.setState({ nameAvailable: null });

        this.checkAccountNameTimer = setTimeout(() => {
            this.setState({ isCheckingName: true });

            const normalizedUsername = username.trim().toLowerCase();

            api.callAsync('condenser_api.lookup_accounts', [normalizedUsername, 1])
                .then((accounts) => {
                    const exists =
                        Array.isArray(accounts) &&
                        accounts.length > 0 &&
                        String(accounts[0]).toLowerCase() === normalizedUsername;

                    if (this.state.targetAuthorityAccount === normalizedUsername) {
                        this.setState({
                            nameAvailable: exists,
                            isCheckingName: false,
                            nameError: exists
                                ? null
                                : tt(
                                      'steem_tools.authority_management.error_account_not_found',
                                      {
                                          fallback:
                                              'Account not found. Authority account must exist.',
                                      }
                                  ),
                        });
                    }
                })
                .catch((error) => {
                    console.error(
                        'API Error checking authority account name:',
                        error
                    );
                    if (this.state.targetAuthorityAccount === normalizedUsername) {
                        this.setState({
                            isCheckingName: false,
                            nameAvailable: null,
                        });
                    }
                });
        }, 500);
    }

    onAcknowledgeToggle(e) {
        this.setState({ acknowledged: e.target.checked });
    }

    onFailure(error) {
        let errorMessage = error;
        if (
            !errorMessage ||
            errorMessage === 0 ||
            errorMessage === false ||
            String(errorMessage).toLowerCase().includes('undefined')
        ) {
            errorMessage = tt(
                'steem_tools.authority_management.unexpected_error'
            );
        }

        this.setState({
            loading: false,
            error: errorMessage,
            success: null,
        });
    }

    onSuccess(authorityType, updatedAuthority) {
        const { currentUser, refreshAccount } = this.props;
        refreshAccount(currentUser);
        this.setState((prevState) => ({
            loading: false,
            error: null,
            success: tt('steem_tools.authority_management.success_message'),
            targetAuthorityAccount: '',
            weight: '1',
            nameError: null,
            nameAvailable: null,
            isCheckingName: false,
            optimisticAuthorities: {
                ...(prevState.optimisticAuthorities || {}),
                [authorityType]: updatedAuthority,
            },
        }));
    }

    buildUpdatedAuthority(removeMode = false, removeAllMode = false) {
        const { account } = this.props;
        const {
            authorityType,
            targetAuthorityAccount,
            weightThreshold,
            weight,
        } = this.state;

        if (!account) {
            throw new Error(
                tt('steem_tools.authority_management.error_no_account_data')
            );
        }

        const currentAuthority = this.getSelectedAuthority(authorityType);
        const parsedThreshold = parseInt(weightThreshold, 10);

        if (!Number.isInteger(parsedThreshold) || parsedThreshold < 1) {
            throw new Error(
                tt('steem_tools.authority_management.error_invalid_threshold')
            );
        }

        if (removeAllMode) {
            return {
                weight_threshold: parsedThreshold,
                account_auths: [],
                key_auths: currentAuthority.key_auths,
            };
        }

        const normalizedTarget = sanitizeAccountInput(targetAuthorityAccount);
        const nameValidationError = validate_account_name(normalizedTarget);
        const parsedWeight = parseInt(weight, 10);

        if (!normalizedTarget) {
            throw new Error(
                tt(
                    'steem_tools.authority_management.error_no_target_authority_account'
                )
            );
        }

        if (nameValidationError) {
            throw new Error(nameValidationError);
        }

        if (
            !removeMode &&
            (!Number.isInteger(parsedWeight) || parsedWeight < 1)
        ) {
            throw new Error(
                tt('steem_tools.authority_management.error_invalid_weight')
            );
        }

        if (!removeMode && parsedWeight > MAX_AUTHORITY_WEIGHT) {
            throw new Error(
                tt('steem_tools.authority_management.error_weight_too_large', {
                    max: MAX_AUTHORITY_WEIGHT,
                    fallback: `Weight cannot be greater than ${MAX_AUTHORITY_WEIGHT}.`,
                })
            );
        }

        const nextAccountAuths = [...currentAuthority.account_auths];
        const existingIndex = nextAccountAuths.findIndex(
            ([name]) => name === normalizedTarget
        );

        if (removeMode) {
            if (existingIndex === -1) {
                throw new Error(
                    tt(
                        'steem_tools.authority_management.error_authority_not_found'
                    )
                );
            }
            nextAccountAuths.splice(existingIndex, 1);
        } else if (existingIndex >= 0) {
            nextAccountAuths[existingIndex] = [normalizedTarget, parsedWeight];
        } else {
            nextAccountAuths.push([normalizedTarget, parsedWeight]);
        }

        nextAccountAuths.sort((a, b) => a[0].localeCompare(b[0]));

        return {
            weight_threshold: parsedThreshold,
            account_auths: nextAccountAuths,
            key_auths: currentAuthority.key_auths,
        };
    }

    getConfirmPayload(removeMode, removeAllMode, updatedAuthority, currentAuthority) {
        const { accountName } = this.props;
        const { authorityType, targetAuthorityAccount, weight } = this.state;

        const authorityTypeLabel = tt(
            `steem_tools.authority_management.authority_${authorityType}`
        );

        if (removeAllMode) {
            const accountNames = currentAuthority.account_auths.map(
                ([name]) => `@${name}`
            );
            const count = accountNames.length;

            if (count <= 5) {
                return tt(
                    'steem_tools.authority_management.confirm_remove_multiple_message',
                    {
                        count,
                        authorityType: authorityTypeLabel,
                        account: `@${accountName}`,
                        accounts: accountNames.join(', '),
                        fallback: `You are about to remove ${count} ${authorityTypeLabel} account authorit${
                            count === 1 ? 'y' : 'ies'
                        } from @${accountName}: ${accountNames.join(
                            ', '
                        )}. Continue?`,
                    }
                );
            }

            return tt(
                'steem_tools.authority_management.confirm_remove_multiple_count_message',
                {
                    count,
                    authorityType: authorityTypeLabel,
                    account: `@${accountName}`,
                    fallback: `You are about to remove ${count} ${authorityTypeLabel} account authorities from @${accountName}. Continue?`,
                }
            );
        }

        const normalizedTarget = sanitizeAccountInput(targetAuthorityAccount);
        const existingRow = currentAuthority.account_auths.find(
            ([name]) => name === normalizedTarget
        );
        const operation = {
            action: removeMode
                ? tt(
                      'steem_tools.authority_management.confirm_action_remove_single',
                      {
                          fallback: 'Remove authority',
                      }
                  )
                : tt(
                      'steem_tools.authority_management.confirm_action_add_single',
                      {
                          fallback: 'Add authority',
                      }
                  ),
            account: `@${accountName}`,
            authority_type: authorityTypeLabel,
            target_account: `@${normalizedTarget}`,
            weight_threshold: String(updatedAuthority.weight_threshold),
            weight: removeMode
                ? String(existingRow ? existingRow[1] : '')
                : String(parseInt(weight, 10)),
        };

        return () => <ConfirmAuthorityManagement operation={operation} />;
    }

    submitAuthorityChange(removeMode = false, removeAllMode = false) {
        const { currentUser, accountName, account, updateAuthority } = this.props;
        const { authorityType, nameError, nameAvailable, isCheckingName, acknowledged } =
            this.state;

        if (!acknowledged) {
            return;
        }

        if (!currentUser) {
            this.setState({
                error: tt('steem_tools.authority_management.error_no_account'),
                success: null,
            });
            return;
        }

        if (!accountName) {
            this.setState({
                error: tt(
                    'steem_tools.authority_management.error_no_target_account'
                ),
                success: null,
            });
            return;
        }

        if (currentUser !== accountName) {
            this.setState({
                error: tt('steem_tools.authority_management.error_not_allowed'),
                success: null,
            });
            return;
        }

        if (!removeMode && !removeAllMode) {
            if (isCheckingName) {
                this.setState({
                    error: tt(
                        'steem_tools.authority_management.error_checking_account',
                        {
                            fallback: 'Still checking account name. Please wait.',
                        }
                    ),
                    success: null,
                });
                return;
            }

            if (nameError || !nameAvailable) {
                this.setState({
                    error:
                        nameError ||
                        tt(
                            'steem_tools.authority_management.error_invalid_account',
                            {
                                fallback: 'Invalid authority account',
                            }
                        ),
                    success: null,
                });
                return;
            }
        }

        try {
            const currentAuthority = this.getSelectedAuthority(authorityType);
            const authority = this.buildUpdatedAuthority(
                removeMode,
                removeAllMode
            );
            const memoKey = getFieldValue(account, 'memo_key', '');
            const jsonMetadata = getFieldValue(account, 'json_metadata', '');
            const confirm = this.getConfirmPayload(
                removeMode,
                removeAllMode,
                authority,
                currentAuthority
            );

            this.setState({
                loading: true,
                error: null,
                success: null,
            });

            updateAuthority(
                accountName,
                authorityType,
                authority,
                memoKey,
                jsonMetadata,
                confirm,
                () => this.onSuccess(authorityType, authority),
                this.onFailure
            );
        } catch (e) {
            this.setState({
                error:
                    e && e.message
                        ? e.message
                        : tt(
                              'steem_tools.authority_management.unexpected_error'
                          ),
                success: null,
            });
        }
    }

    onAddAuthority() {
        this.submitAuthorityChange(false, false);
    }

    onRemoveAllAuthorities() {
        this.submitAuthorityChange(false, true);
    }

    onRemoveSingleAuthority(type, name) {
        const { loading } = this.state;
        const { currentUser, accountName } = this.props;

        if (loading || currentUser !== accountName) return;

        this.setState(
            {
                authorityType: type,
                targetAuthorityAccount: name,
                nameError: null,
                nameAvailable: true,
                isCheckingName: false,
                error: null,
                success: null,
            },
            () => {
                this.submitAuthorityChange(true, false);
            }
        );
    }

    renderCurrentAuthoritiesDesktop(rows, canEdit) {
        if (!rows.length) {
            return (
                <div className="change-recovery-account-hint">
                    {tt('steem_tools.authority_management.no_account_authorities')}
                </div>
            );
        }

        return (
            <div
                className="AuthorityManagementTableWrapper"
                style={{ marginBottom: '1.25rem' }}
            >
                <table className="KeyGenerationTable">
                    <thead>
                        <tr>
                            <th>{tt('steem_tools.authority_management.authority_type')}</th>
                            <th>
                                {tt(
                                    'steem_tools.authority_management.authorized_account_header'
                                )}
                            </th>
                            <th>{tt('steem_tools.authority_management.weight_header')}</th>
                            <th />
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map(({ type, name, weight }) => (
                            <tr key={`${type}-${name}`}>
                                <td className="key-type-cell">
                                    {tt(
                                        `steem_tools.authority_management.authority_${type}`
                                    )}
                                </td>
                                <td className="key-type-cell">
                                    <Link to={`/@${name}`}>@{name}</Link>
                                </td>
                                <td className="key-value-cell">{weight}</td>
                                <td style={{ textAlign: 'right' }}>
                                    <button
                                        type="button"
                                        className="button alert hollow tiny"
                                        style={{
                                            margin: 0,
                                            padding: '0.2rem 0.6rem',
                                        }}
                                        onClick={() =>
                                            this.onRemoveSingleAuthority(type, name)
                                        }
                                        disabled={this.state.loading || !canEdit}
                                    >
                                        x
                                    </button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        );
    }

    render() {
        const { currentUser, accountName } = this.props;
        const {
            authorityType,
            targetAuthorityAccount,
            weight,
            weightThreshold,
            loading,
            error,
            success,
            nameError,
            nameAvailable,
            isCheckingName,
            acknowledged,
        } = this.state;

        const isOwner = !!currentUser && !!accountName && currentUser === accountName;
        const canEdit = !loading && isOwner;
        const currentSelectedAuthority = this.getSelectedAuthority(authorityType);
        const rows = this.getAuthorityRows();
        const hasAuthorities = currentSelectedAuthority.account_auths.length > 0;

        return (
            <div>
                <div className="advtools-panel">
                    <div className="row">
                        <h3 className="column">
                            {tt('steem_tools.authority_management.title')}
                        </h3>
                    </div>

                    <div>
                        <div className="row">
                            <div className="column small-12">
                                <FormattedHTMLMessage
                                    className="secondary"
                                    id="steem_tools.authority_management.description"
                                />
                            </div>
                        </div>
                        <br />
                    </div>

                    <div style={{ marginTop: 14 }}>
                        <div className="row row-column-mobile">
                            <div
                                className="column flex-container-1-extended flex-mobile-full"
                                style={{ paddingTop: 5 }}
                            >
                                <div>
                                    {tt(
                                        'steem_tools.authority_management.account_to_modify'
                                    )}
                                </div>
                            </div>
                            <div className="column flex-container-2-extended flex-mobile-full">
                                <div
                                    className="input-group"
                                    style={{ marginBottom: '1.25rem' }}
                                >
                                    <span className="input-group-label">@</span>
                                    <input
                                        type="text"
                                        value={accountName || ''}
                                        disabled
                                        className="input-group-field bold"
                                    />
                                </div>
                            </div>
                        </div>

                        <div
                            className="row row-column-mobile"
                            style={{ marginBottom: '1.25rem' }}
                        >
                            <div
                                className="column flex-container-1-extended flex-mobile-full"
                                style={{ paddingTop: 5 }}
                            >
                                <div>
                                    {tt(
                                        'steem_tools.authority_management.authority_type'
                                    )}
                                </div>
                            </div>
                            <div className="column flex-container-2-extended flex-mobile-full">
                                <select
                                    className="input-group-field"
                                    name="authorityType"
                                    value={authorityType}
                                    onChange={this.onAuthorityTypeChange}
                                    disabled={!canEdit}
                                    style={{ marginBottom: '1.25rem' }}
                                >
                                    <option value="owner">
                                        {tt(
                                            'steem_tools.authority_management.authority_owner'
                                        )}
                                    </option>
                                    <option value="active">
                                        {tt(
                                            'steem_tools.authority_management.authority_active'
                                        )}
                                    </option>
                                    <option value="posting">
                                        {tt(
                                            'steem_tools.authority_management.authority_posting'
                                        )}
                                    </option>
                                </select>
                            </div>
                        </div>

                        <div className="row row-column-mobile">
                            <div
                                className="column flex-container-1-extended flex-mobile-full"
                                style={{ paddingTop: 5 }}
                            >
                                <div>
                                    {tt(
                                        'steem_tools.authority_management.weight_threshold'
                                    )}
                                </div>
                            </div>
                            <div className="column flex-container-2-extended flex-mobile-full">
                                <input
                                    className="input-group-field bold"
                                    type="text"
                                    inputMode="numeric"
                                    pattern="[0-9]*"
                                    name="weightThreshold"
                                    value={weightThreshold}
                                    onChange={this.onChange}
                                    onKeyDown={preventInvalidNumberKeys}
                                    disabled={!canEdit}
                                    style={{ marginBottom: '0.5rem' }}
                                />
                                <div className="change-recovery-account-hint">
                                    {tt(
                                        'steem_tools.authority_management.weight_threshold_hint'
                                    )}
                                </div>
                            </div>
                        </div>

                        <div className="row row-column-mobile">
                            <div
                                className="column flex-container-1-extended flex-mobile-full"
                                style={{ paddingTop: 5 }}
                            >
                                <div>
                                    {tt(
                                        'steem_tools.authority_management.add_account_authority'
                                    )}
                                </div>
                            </div>
                            <div className="column flex-container-2-extended flex-mobile-full">
                                <div
                                    className={`input-group ${
                                        nameError ? 'advtools-input-group-error' : ''
                                    }`}
                                    style={{
                                        marginBottom: nameError ? '0.25rem' : '0.5rem',
                                        position: 'relative',
                                    }}
                                >
                                    <span className="input-group-label">@</span>
                                    <input
                                        className={
                                            'input-group-field bold' +
                                            (nameError
                                                ? ' advtools-input-error'
                                                : nameAvailable
                                                ? ' advtools-input-success'
                                                : '')
                                        }
                                        type="text"
                                        name="targetAuthorityAccount"
                                        value={targetAuthorityAccount}
                                        onChange={this.onChange}
                                        autoComplete="off"
                                        autoCorrect="off"
                                        autoCapitalize="off"
                                        spellCheck="false"
                                        disabled={!canEdit}
                                        placeholder={tt(
                                            'steem_tools.authority_management.account_name_placeholder'
                                        )}
                                    />
                                    {isCheckingName && (
                                        <div
                                            style={{
                                                position: 'absolute',
                                                right: '12px',
                                                top: 0,
                                                bottom: 0,
                                                display: 'flex',
                                                alignItems: 'center',
                                                pointerEvents: 'none',
                                                opacity: 0.7,
                                            }}
                                        >
                                            <LoadingIndicator type="circle" />
                                        </div>
                                    )}
                                </div>

                                {nameError && (
                                    <div className="advtools-error-hint">
                                        {nameError}
                                    </div>
                                )}

                                {nameAvailable === true && !nameError && (
                                    <div
                                        className="advtools-error-hint"
                                        style={{ color: 'var(--accent)' }}
                                    >
                                        {tt(
                                            'steem_tools.authority_management.success_account_found',
                                            {
                                                fallback: 'Account found',
                                            }
                                        )}
                                    </div>
                                )}

                                {!nameError &&
                                    !nameAvailable &&
                                    !isCheckingName && (
                                        <div className="change-recovery-account-hint">
                                            {tt('steem_tools.authority_management.account_authority_hint',)}
                                        </div>
                                    )}
                            </div>
                        </div>

                        <div className="row row-column-mobile">
                            <div
                                className="column flex-container-1-extended flex-mobile-full"
                                style={{ paddingTop: 5 }}
                            >
                                <div>
                                    {tt('steem_tools.authority_management.weight')}
                                </div>
                            </div>
                            <div className="column flex-container-2-extended flex-mobile-full">
                                <input
                                    className="input-group-field bold"
                                    type="text"
                                    inputMode="numeric"
                                    pattern="[0-9]*"
                                    name="weight"
                                    value={weight}
                                    onChange={this.onChange}
                                    onKeyDown={preventInvalidNumberKeys}
                                    disabled={!canEdit}
                                    style={{ marginBottom: '0.5rem' }}
                                />
                                <div className="change-recovery-account-hint">
                                    {tt(
                                        'steem_tools.authority_management.weight_hint',
                                        {
                                            max: MAX_AUTHORITY_WEIGHT,
                                        }
                                    )}
                                </div>
                            </div>
                        </div>

                        <div className="row">
                            <div className="column small-12">
                                <h4>
                                    {tt(
                                        'steem_tools.authority_management.current_account_authorities'
                                    )}
                                </h4>
                            </div>
                        </div>

                        <div className="row">
                            <div className="column small-12">
                                <div className="show-for-small-only">
                                    <AuthorityManagementSmallTable
                                        rows={rows}
                                        loading={loading}
                                        canEdit={canEdit && acknowledged}
                                        onRemoveSingleAuthority={
                                            this.onRemoveSingleAuthority
                                        }
                                    />
                                </div>
                                <div className="hide-for-small-only">
                                    {this.renderCurrentAuthoritiesDesktop(
                                        rows,
                                        canEdit && acknowledged
                                    )}
                                </div>
                            </div>
                        </div>

                        {!loading && !isOwner && currentUser && accountName ? (
                            <div className="row" style={{ marginBottom: '1rem' }}>
                                <div className="column small-12">
                                    <div className="advtools-message-error">
                                        {tt(
                                            'steem_tools.authority_management.error_not_allowed'
                                        )}
                                    </div>
                                </div>
                            </div>
                        ) : null}

                        {!loading && error ? (
                            <div className="row" style={{ marginBottom: '1rem' }}>
                                <div className="column small-12">
                                    <div className="advtools-message-error">
                                        {error}
                                    </div>
                                </div>
                            </div>
                        ) : null}

                        {!loading && success ? (
                            <div className="row" style={{ marginBottom: '1rem' }}>
                                <div className="column small-12">
                                    <div className="advtools-message-success">
                                        {success}
                                    </div>
                                </div>
                            </div>
                        ) : null}

                        <div className="row" style={{ marginTop: '1rem', marginBottom: '1rem' }}>
                            <div className="column toggle_container advtools-acknowledge-check">
                                <span>
                                    {tt('steem_tools.authority_management.acknowledge_warning')}
                                </span>
                                <label className="switch">
                                    <input
                                        type="checkbox"
                                        checked={acknowledged}
                                        onChange={this.onAcknowledgeToggle}
                                    />
                                    <span className="slider round" />
                                </label>
                            </div>
                        </div>

                        <div className="row">
                            <div className="column">
                                {loading ? (
                                    <span>
                                        <LoadingIndicator type="circle" />
                                    </span>
                                ) : (
                                    <span
                                        style={{
                                            display: 'inline-flex',
                                            gap: '1rem',
                                            alignItems: 'center',
                                            flexWrap: 'wrap',
                                        }}
                                    >
                                        <button
                                            type="button"
                                            className="button advtools-btn-primary"
                                            onClick={this.onAddAuthority}
                                            disabled={
                                                !canEdit ||
                                                !(targetAuthorityAccount &&
                                                    targetAuthorityAccount.trim()) ||
                                                !!nameError ||
                                                nameAvailable !== true ||
                                                isCheckingName ||
                                                !acknowledged
                                            }
                                            style={{ margin: 0 }}
                                        >
                                            {tt(
                                                'steem_tools.authority_management.add_authority_btn'
                                            )}
                                        </button>

                                        <button
                                            type="button"
                                            className="button advtools-btn-primary"
                                            onClick={this.onRemoveAllAuthorities}
                                            disabled={!canEdit || !hasAuthorities || !acknowledged}
                                            style={{
                                                margin: 0,
                                            }}
                                        >
                                            {tt(
                                                'steem_tools.authority_management.remove_all_btn'
                                            )}
                                        </button>
                                    </span>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        );
    }
}

export default connect(
    (state, ownProps) => {
        const user = state.user.get('current');
        const currentUser = user && user.get('username');

        const accountName = ownProps.accountname || currentUser || '';

        const account = accountName
            ? state.global.getIn(['accounts', accountName])
            : null;

        return {
            currentUser,
            accountName,
            account,
        };
    },
    (dispatch) => ({
        updateAuthority: (
            account,
            authorityType,
            authority,
            memoKey,
            jsonMetadata,
            confirm,
            successCallback,
            errorCallback
        ) => {
            const successCb = () => {
                dispatch(globalActions.getState({ url: `@${account}/permissions` }));
                if (successCallback) successCallback();
            };

            const operation = {
                account,
                memo_key: memoKey || '',
                json_metadata: jsonMetadata || '',
                [authorityType]: authority,
            };

            dispatch(
                transactionActions.broadcastOperation({
                    type: 'account_update',
                    operation,
                    confirm,
                    successCallback: successCb,
                    errorCallback,
                })
            );
        },
        refreshAccount: (username) =>
            dispatch(
                userActions.refreshAccount({
                    username,
                })
            ),
        removeNotification: (key) =>
            dispatch(appActions.removeNotification({ key })),
    })
)(AuthorityManagement);
