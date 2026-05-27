import React from 'react';
import { connect } from 'react-redux';
import tt from 'counterpart';
import { FormattedHTMLMessage } from 'app/Translator';
import LoadingIndicator from 'app/components/elements/LoadingIndicator';
import { api } from '@steemit/steem-js';
import * as transactionActions from 'app/redux/TransactionReducer';
import * as appActions from 'app/redux/AppReducer';
import * as globalActions from 'app/redux/GlobalReducer';
import * as userActions from 'app/redux/UserReducer';
import ConfirmCreateWitness from 'app/components/elements/ConfirmCreateWitness';

const NULL_WITNESS_SIGNING_KEY = 'STM1111111111111111111111111111111114T1Anm';

class CreateWitness extends React.Component {
    constructor(props) {
        super(props);
        this.state = {
            blockSigningKey: '',
            witnessUrl: '',
            accountCreationFee: '0.000 STEEM',
            maximumBlockSize: '65536',
            sbdInterestRate: '0',
            loading: false,
            loadingWitnessData: false,
            error: null,
            success: null,
            isExistingWitness: false,
        };

        this.onChange = this.onChange.bind(this);
        this.onSubmit = this.onSubmit.bind(this);
        this.onFailure = this.onFailure.bind(this);
        this.onSuccess = this.onSuccess.bind(this);
        this.loadWitnessData = this.loadWitnessData.bind(this);
        this.isNullWitnessSigningKey = this.isNullWitnessSigningKey.bind(this);
        this.isValidSigningKey = this.isValidSigningKey.bind(this);
    }

    componentDidMount() {
        this.loadWitnessData(this.props);
    }

    componentDidUpdate(prevProps) {
        if (prevProps.accountName !== this.props.accountName) {
            this.loadWitnessData(this.props);
        }
    }

    onChange(e) {
        const { name, value } = e.target;
        let nextValue = value;
        if (name === 'sbdInterestRate') {
            if (value === '') {
                nextValue = '';
            } else {
                const numericValue = parseFloat(value);
                if (!Number.isNaN(numericValue)) {
                    nextValue = String(Math.min(100, Math.max(0, numericValue)));
                }
            }
        }
        this.setState({
            [name]: nextValue,
            error: null,
            success: null,
        });
    }

    isNullWitnessSigningKey(value) {
        return String(value || '').trim() === NULL_WITNESS_SIGNING_KEY;
    }

    isValidSigningKey(value) {
        const normalized = String(value || '').trim();
        if (!normalized) return false;
        return (
            normalized === NULL_WITNESS_SIGNING_KEY ||
            /^STM[1-9A-HJ-NP-Za-km-z]{50}$/.test(normalized)
        );
    }

    async loadWitnessData(props = this.props) {
        const { accountName } = props;
        if (!accountName) return;

        this.setState({ loadingWitnessData: true, error: null, success: null });

        try {
            const witness = await api.getWitnessByAccountAsync(accountName);

            if (witness) {
                const propsData = witness.props || {};
                const blockchainSbdInterestRate = Number(propsData.sbd_interest_rate || 0);
                const displaySbdInterestRate = String(blockchainSbdInterestRate / 100);

                this.setState({
                    blockSigningKey: witness.signing_key || '',
                    witnessUrl: witness.url || '',
                    accountCreationFee: propsData.account_creation_fee || '0.000 STEEM',
                    maximumBlockSize: String(propsData.maximum_block_size || 65536),
                    sbdInterestRate: displaySbdInterestRate,
                    isExistingWitness: true,
                    loadingWitnessData: false,
                });
                return;
            }

            this.setState({
                blockSigningKey: '',
                witnessUrl: '',
                accountCreationFee: '0.000 STEEM',
                maximumBlockSize: '65536',
                sbdInterestRate: '0',
                isExistingWitness: false,
                loadingWitnessData: false,
            });
        } catch (error) {
            this.setState({
                loadingWitnessData: false,
                error: tt('steem_tools.create_witness.error_loading_witness'),
            });
        }
    }

    onFailure(error) {
        let errorMessage = error;
        if (!errorMessage || String(errorMessage).toLowerCase().includes('undefined')) {
            errorMessage = tt('steem_tools.create_witness.unexpected_error');
        }
        this.setState({ loading: false, error: errorMessage, success: null });
    }

    onSuccess() {
        const { currentUser, refreshAccount } = this.props;
        refreshAccount(currentUser);
        this.setState({
            loading: false,
            error: null,
            success: tt('steem_tools.create_witness.success_message'),
        });
        this.loadWitnessData();
    }

    onSubmit() {
        const { currentUser, accountName, broadcastWitnessSetProperties } = this.props;
        const {
            blockSigningKey,
            witnessUrl,
            accountCreationFee,
            maximumBlockSize,
            sbdInterestRate,
        } = this.state;

        if (!currentUser || currentUser !== accountName) {
            this.setState({ error: tt('steem_tools.create_witness.error_not_allowed') });
            return;
        }

        if (!blockSigningKey.trim() || !witnessUrl.trim()) {
            this.setState({ error: tt('steem_tools.create_witness.error_no_signing_key') });
            return;
        }

        if (!this.isValidSigningKey(blockSigningKey)) {
            this.setState({ error: tt('steem_tools.create_witness.error_invalid_signing_key') });
            return;
        }

        if (!/^https?:\/\/.+/i.test(witnessUrl.trim())) {
            this.setState({ error: tt('steem_tools.create_witness.error_invalid_url') });
            return;
        }

        const feeValue = parseFloat(accountCreationFee.replace(' STEEM', ''));
        const parsedMaxBlockSize = parseInt(maximumBlockSize, 10);
        const parsedSbdRatePercent = parseFloat(sbdInterestRate);

        if (isNaN(parsedSbdRatePercent) || parsedSbdRatePercent < 0 || parsedSbdRatePercent > 100) {
            this.setState({ error: tt('steem_tools.create_witness.error_invalid_sbd_interest_rate') });
            return;
        }

        const blockchainSbdInterestRate = Math.round(parsedSbdRatePercent * 100);

        const operation = {
            owner: accountName,
            props: {
                account_creation_fee: feeValue.toFixed(3) + ' STEEM',
                maximum_block_size: parsedMaxBlockSize,
                sbd_interest_rate: blockchainSbdInterestRate,
                url: witnessUrl.trim(),
                new_signing_key: blockSigningKey.trim(),
            },
            extensions: [],
        };

        this.setState({ loading: true, error: null, success: null });
        broadcastWitnessSetProperties(
            operation,
            this.state.isExistingWitness,
            this.onSuccess,
            this.onFailure
        );
    }

    render() {
        const { currentUser, accountName } = this.props;
        const {
            blockSigningKey,
            witnessUrl,
            accountCreationFee,
            maximumBlockSize,
            sbdInterestRate,
            loading,
            loadingWitnessData,
            error,
            success,
            isExistingWitness,
        } = this.state;

        const isOwner = !!currentUser && !!accountName && currentUser === accountName;
        const isNullSigningKey = this.isNullWitnessSigningKey(blockSigningKey);
        const isKeyValid = blockSigningKey === '' || this.isValidSigningKey(blockSigningKey);
        const isUrlValid = witnessUrl === '' || /^https?:\/\/.+/i.test(witnessUrl.trim());
        const parsedSbdRate = parseFloat(sbdInterestRate);
        const isSbdRateValid = sbdInterestRate === '' || (!Number.isNaN(parsedSbdRate) && parsedSbdRate >= 0 && parsedSbdRate <= 100);

        const canEdit = !loading && !loadingWitnessData && isOwner;
        const canSubmit =
            canEdit &&
            blockSigningKey.trim() !== '' &&
            witnessUrl.trim() !== '' &&
            isKeyValid &&
            isUrlValid &&
            isSbdRateValid;

        return (
            <div className="advtools-panel">
                <div className="row">
                    <h3 className="column">{tt('steem_tools.create_witness.title')}</h3>
                </div>

                <div className="row">
                    <div className="column small-12">
                        <FormattedHTMLMessage
                            className="secondary"
                            id="steem_tools.create_witness.description"
                        />
                    </div>
                </div>

                <div style={{ marginTop: 20 }}>
                    <div className="row row-column-mobile" style={{ marginBottom: '1.25rem' }}>
                        <div className="column flex-container-1-extended" style={{ paddingTop: 5 }}>
                            {tt('steem_tools.create_witness.witness_account')}
                        </div>
                        <div className="column flex-container-2-extended">
                            <div className="input-group" style={{ marginBottom: '0.25rem' }}>
                                <span className="input-group-label">@</span>
                                <input
                                    type="text"
                                    value={accountName || ''}
                                    disabled
                                    className="input-group-field bold"
                                />
                            </div>
                            <div className="change-recovery-account-hint">
                                {isExistingWitness
                                    ? tt('steem_tools.create_witness.mode_update')
                                    : tt('steem_tools.create_witness.mode_create')}
                            </div>
                        </div>
                    </div>

                    <div className="row row-column-mobile" style={{ marginBottom: '1.25rem' }}>
                        <div className="column flex-container-1-extended" style={{ paddingTop: 5 }}>
                            {tt('steem_tools.create_witness.block_signing_key')}
                        </div>
                        <div className="column flex-container-2-extended">
                            <input
                                className={`input-group-field bold ${!isKeyValid ? 'advtools-input-error' : ''}`}
                                type="text"
                                name="blockSigningKey"
                                value={blockSigningKey}
                                onChange={this.onChange}
                                disabled={!canEdit}
                                placeholder={tt('steem_tools.create_witness.block_signing_key_placeholder')}
                            />
                            {!isKeyValid ? (
                                <div className="advtools-error-hint">
                                    {tt('steem_tools.create_witness.error_invalid_signing_key')}
                                </div>
                            ) : isNullSigningKey ? (
                                <div className="advtools-error-hint">
                                    {tt('steem_tools.create_witness.disable_signing_key_hint')}
                                </div>
                            ) : (
                                <div className="change-recovery-account-hint">
                                    {tt('steem_tools.create_witness.block_signing_key_hint')}
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="row row-column-mobile" style={{ marginBottom: '1.25rem' }}>
                        <div className="column flex-container-1-extended" style={{ paddingTop: 5 }}>
                            {tt('steem_tools.create_witness.witness_url')}
                        </div>
                        <div className="column flex-container-2-extended">
                            <input
                                className={`input-group-field bold ${!isUrlValid ? 'advtools-input-error' : ''}`}
                                type="text"
                                name="witnessUrl"
                                value={witnessUrl}
                                onChange={this.onChange}
                                disabled={!canEdit}
                                placeholder={tt('steem_tools.create_witness.witness_url_placeholder')}
                            />
                            {!isUrlValid && (
                                <div className="advtools-error-hint">
                                    {tt('steem_tools.create_witness.error_invalid_url')}
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="row row-column-mobile" style={{ marginBottom: '1.25rem' }}>
                        <div className="column flex-container-1-extended" style={{ paddingTop: 5 }}>
                            {tt('steem_tools.create_witness.account_creation_fee')}
                        </div>
                        <div className="column flex-container-2-extended">
                            <div className="input-group">
                                <input
                                    className="input-group-field bold"
                                    type="number"
                                    step="0.001"
                                    name="accountCreationFee"
                                    value={accountCreationFee.replace(' STEEM', '')}
                                    onChange={(e) =>
                                        this.onChange({
                                            target: {
                                                name: 'accountCreationFee',
                                                value: `${e.target.value} STEEM`,
                                            },
                                        })
                                    }
                                    disabled={!canEdit}
                                />
                                <span className="input-group-label">STEEM</span>
                            </div>
                        </div>
                    </div>

                    <div className="row row-column-mobile" style={{ marginBottom: '1.25rem' }}>
                        <div className="column flex-container-1-extended" style={{ paddingTop: 5 }}>
                            {tt('steem_tools.create_witness.sbd_interest_rate')}
                        </div>
                        <div className="column flex-container-2-extended">
                            <div className="input-group">
                                <input
                                    className={`input-group-field bold ${!isSbdRateValid ? 'advtools-input-error' : ''}`}
                                    type="number"
                                    step="0.01"
                                    min="0"
                                    max="100"
                                    name="sbdInterestRate"
                                    value={sbdInterestRate}
                                    onChange={this.onChange}
                                    disabled={!canEdit}
                                />
                                <span className="input-group-label">%</span>
                            </div>
                            {!isSbdRateValid && (
                                <div className="advtools-error-hint">
                                    {tt('steem_tools.create_witness.error_invalid_sbd_interest_rate')}
                                </div>
                            )}
                        </div>
                    </div>

                    {(error || success) && (
                        <div className="row" style={{ marginBottom: '1rem' }}>
                            <div className="column small-12">
                                {error && <div className="advtools-message-error">{error}</div>}
                                {success && <div className="advtools-message-success">{success}</div>}
                            </div>
                        </div>
                    )}

                    <div className="row">
                        <div className="column">
                            {loading || loadingWitnessData ? (
                                <LoadingIndicator type="circle" />
                            ) : (
                                <button
                                    type="button"
                                    className="button advtools-btn-primary"
                                    onClick={this.onSubmit}
                                    disabled={!canSubmit}
                                >
                                    {isExistingWitness
                                        ? tt('steem_tools.create_witness.update_btn')
                                        : tt('steem_tools.create_witness.create_btn')}
                                </button>
                            )}
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
        const account = accountName ? state.global.getIn(['accounts', accountName]) : null;
        return { currentUser, accountName, account };
    },
    (dispatch) => ({
        broadcastWitnessSetProperties: (operation, isExistingWitness, successCallback, errorCallback) => {
            const successCb = () => {
                dispatch(globalActions.getState({ url: `@${operation.owner}/witnesses` }));
                if (successCallback) successCallback();
            };

            const confirm = () => (
                <ConfirmCreateWitness
                    operation={{
                        ...operation.props,
                        owner: operation.owner,
                        mode: isExistingWitness ? 'update' : 'create',
                    }}
                />
            );

            dispatch(
                transactionActions.broadcastOperation({
                    type: 'witness_set_properties',
                    operation,
                    confirm,
                    successCallback: successCb,
                    errorCallback,
                })
            );
        },
        refreshAccount: (username) => dispatch(userActions.refreshAccount({ username })),
    })
)(CreateWitness);
