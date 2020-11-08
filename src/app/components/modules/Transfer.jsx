/* eslint-disable react/forbid-prop-types */
/* eslint-disable react/no-string-refs */
/* eslint-disable jsx-a11y/no-static-element-interactions */
/* eslint-disable react/no-find-dom-node */
/* eslint-disable no-undef */
import React, { Component } from 'react';
import PropTypes from 'prop-types';
import ReactDOM from 'react-dom';
import reactForm from 'app/utils/ReactForm';
import { Map, List, OrderedSet } from 'immutable';
import Autocomplete from 'react-autocomplete';
import tt from 'counterpart';

import * as transactionActions from 'app/redux/TransactionReducer';
import * as userActions from 'app/redux/UserReducer';
import * as globalActions from 'app/redux/GlobalReducer';
import * as appActions from 'app/redux/AppReducer';
import LoadingIndicator from 'app/components/elements/LoadingIndicator';
import ConfirmTransfer from 'app/components/elements/ConfirmTransfer';
import runTests, { browserTests } from 'app/utils/BrowserTests';
import { recordAdsView } from 'app/utils/ServerApiClient';
import {
    validate_account_name_with_memo,
    validate_memo_field,
    validate_account_name,
} from 'app/utils/ChainValidation';
import { countDecimals } from 'app/utils/ParsersAndFormatters';
import { APP_NAME, LIQUID_TOKEN, VESTING_TOKEN } from 'app/client_config';
import { connect } from 'react-redux';

/** Warning .. This is used for Power UP too. */
class TransferForm extends Component {
    static propTypes = {
        // redux
        currentUser: PropTypes.object.isRequired,
        toVesting: PropTypes.bool.isRequired,
        currentAccount: PropTypes.object.isRequired,
        following: PropTypes.object.isRequired,
    };

    static defaultProps = {
        following: OrderedSet([]),
    };

    constructor(props) {
        super(props);
        const { transferToSelf, initialValues } = props;
        this.state = {
            advanced: !transferToSelf,
            transferTo: false,
            autocompleteUsers: [],
            switchTron: false,
            switchSteem: true,
            tronTransfer: initialValues.asset == 'TRX',
            hide_tron_address: '',
            tronTransferStepOne: false,
            tronTransferStepTwo: false,
            tronPrivateKey: '',
            show_transfer_button: false,
            tronLoading: false,
        };
        this.initForm(props);
        this.tronValidationLock = undefined;
    }

    componentDidMount() {
        setTimeout(() => {
            const { advanced } = this.state;
            if (advanced) this.to.focus();
            else ReactDOM.findDOMNode(this.refs.amount).focus();
        }, 300);

        runTests();

        this.buildTransferAutocomplete();
    }

    componentWillUnmount() {
        this.clearToTronInfo();
    }

    // covert tron address into the one only showing first and last 6 digit
    covertTronAddress = tronAddr => {
        if (!tronAddr) return;
        return `${tronAddr.substring(0, 6)}${String().padStart(
            6,
            '.'
        )}${tronAddr.slice(-6)}`;
    };

    buildTransferAutocomplete() {
        // Get names for the recent account transfers
        const labelPreviousTransfers = tt(
            'transfer_jsx.autocomplete_previous_transfers'
        );
        const labelFollowingUser = tt(
            'transfer_jsx.autocomplete_user_following'
        );

        const transferToLog = this.props.currentAccount
            .get('transfer_history', List())
            .reduce((acc, cur) => {
                if (cur.getIn([1, 'op', 0]) === 'transfer') {
                    const username = cur.getIn([1, 'op', 1, 'to']);
                    const numTransfers = acc.get(username)
                        ? acc.get(username).numTransfers + 1
                        : 1;
                    return acc.set(username, {
                        username,
                        label: `${numTransfers} ${labelPreviousTransfers}`,
                        numTransfers,
                    });
                }
                return acc;
            }, Map())
            .remove(this.props.currentUser.get('username'));

        // Build a combined list of users you follow & have previously transferred to,
        // and sort it by 1. desc the number of previous transfers 2. username asc.
        this.setState({
            autocompleteUsers: this.props.following
                .toOrderedMap()
                .map(username => ({
                    username,
                    label: labelFollowingUser,
                    numTransfers: 0,
                }))
                .merge(transferToLog)
                .sortBy(null, (a, b) => {
                    //prioritize sorting by number of transfers
                    if (a.numTransfers > b.numTransfers) {
                        return -1;
                    }
                    if (b.numTransfers > a.numTransfers) {
                        return 1;
                    }
                    //if transfer number is the same, sort by username
                    if (a.username > b.username) {
                        return 1;
                    }
                    if (b.username > a.username) {
                        return -1;
                    }
                    return 0;
                })
                .toArray(),
        });
    }

    matchAutocompleteUser = (item, value) => {
        return item.username.toLowerCase().indexOf(value.toLowerCase()) > -1;
    };

    onAdvanced = e => {
        e.preventDefault(); // prevent form submission!!
        const username = this.props.currentUser.get('username');
        this.state.to.props.onChange(username);
        // setTimeout(() => {ReactDOM.findDOMNode(this.refs.amount).focus()}, 300)
        this.setState({ advanced: !this.state.advanced });
    };

    tronValidation = (from, to) => {
        if (this.state.tronTransfer) {
            if (this.state.switchSteem) {
                const text = validate_account_name(to);
                if (text !== null) return text;
                if (this.tronValidationLock) {
                    clearTimeout(this.tronValidationLock);
                    this.props.unlockTransferAsyncValidation();
                }
                // lock async validations
                this.props.lockTransferAsyncValidation();
                this.tronValidationLock = setTimeout(() => {
                    this.props.checkTron(from, to, 'steem');
                }, 800);
                return null;
            } else if (this.state.switchTron) {
                if (to.length !== 34) {
                    return tt('transfer_jsx.invalid_tron_address');
                }
                if (from === to) {
                    return tt('tron_jsx.cannot_transfer_to_yourself');
                }
                this.props.setToTronAddr(to);
                return null;
            }
        }
        return null;
    };

    initForm(props) {
        const { transferType } = props.initialValues;
        const insufficientFunds = (asset, amount) => {
            const { currentAccount } = props;
            const isWithdraw =
                transferType && transferType === 'Savings Withdraw';
            const balanceValue =
                !asset || asset === 'STEEM'
                    ? isWithdraw
                        ? currentAccount.get('savings_balance')
                        : currentAccount.get('balance')
                    : asset === 'SBD'
                        ? isWithdraw
                            ? currentAccount.get('savings_sbd_balance')
                            : currentAccount.get('sbd_balance')
                        : asset === 'TRX'
                            ? this.props.tronBalance + ' TRX'
                            : null;
            if (!balanceValue) return false;
            const balance = balanceValue.split(' ')[0];
            return parseFloat(amount) > parseFloat(balance);
            // return parseFloat(balance) == 0.00 ? true: parseFloat(amount) > parseFloat(balance);
        };
        const { toVesting } = props;
        const fields = toVesting ? ['to', 'amount'] : ['to', 'amount', 'asset'];
        if (
            !toVesting &&
            transferType !== 'Transfer to Savings' &&
            transferType !== 'Savings Withdraw'
        ) {
            fields.push('memo');
        }
        reactForm({
            name: 'transfer',
            instance: this,
            fields,
            initialValues: props.initialValues,
            validation: values => ({
                to: !values.to
                    ? tt('g.required')
                    : this.state.tronTransfer
                        ? this.tronValidation(props.tronAddr, values.to)
                        : validate_account_name_with_memo(
                              values.to,
                              values.memo
                          ),
                amount: !values.amount
                    ? tt('g.required')
                    : !/^\d+(\.\d+)?$/.test(values.amount)
                        ? tt('transfer_jsx.amount_is_in_form')
                        : insufficientFunds(values.asset, values.amount)
                            ? tt('transfer_jsx.insufficient_funds')
                            : this.state.tronTransfer
                                ? countDecimals(values.amount) > 6
                                    ? tt(
                                          'transfer_jsx.use_only_6_digits_of_precision'
                                      )
                                    : null
                                : countDecimals(values.amount) > 3
                                    ? tt(
                                          'transfer_jsx.use_only_3_digits_of_precison'
                                      )
                                    : null,
                asset: props.toVesting
                    ? null
                    : !values.asset
                        ? tt('g.required')
                        : null,
                memo: values.memo
                    ? validate_memo_field(
                          values.memo,
                          props.currentUser.get('username'),
                          props.currentAccount.get('memo_key')
                      )
                    : values.memo &&
                      (!browserTests.memo_encryption && /^#/.test(values.memo))
                        ? 'Encrypted memos are temporarily unavailable (issue #98)'
                        : null,
            }),
        });
    }

    clearError = () => {
        this.setState({ trxError: undefined, tronLoading: false });
    };

    errorCallback = estr => {
        this.setState({ trxError: estr, loading: false, tronLoading: false });
    };

    balanceValue() {
        const { transferType } = this.props.initialValues;
        const { currentAccount } = this.props;
        const { asset } = this.state;
        const isWithdraw = transferType && transferType === 'Savings Withdraw';
        return !asset || asset.value === 'STEEM'
            ? isWithdraw
                ? currentAccount.get('savings_balance')
                : currentAccount.get('balance')
            : asset.value === 'SBD'
                ? isWithdraw
                    ? currentAccount.get('savings_sbd_balance')
                    : currentAccount.get('sbd_balance')
                : asset.value === 'TRX'
                    ? Math.floor(this.props.tronBalance * 1000) / 1000 + ' TRX'
                    : null;
    }

    assetBalanceClick = e => {
        e.preventDefault();
        // Convert '9.999 STEEM' to 9.999
        this.state.amount.props.onChange(this.balanceValue().split(' ')[0]);
    };

    onChangeTo = async value => {
        if (this.state.tronTransfer) {
            // tron transfer
            this.state.to.props.onChange(value);
        } else {
            // origin steem, sbd, etc. trnasfer
            this.state.to.props.onChange(value);
        }
    };

    clearToTronInfo = () => {
        this.props.checkTron(null, null, null);
    };

    render() {
        const transferTips = {
            'Transfer to Account': tt(
                'transfer_jsx.move_funds_to_another_account',
                { APP_NAME }
            ),
            'Transfer to Savings': tt(
                'transfer_jsx.protect_funds_by_requiring_a_3_day_withdraw_waiting_period'
            ),
            'Savings Withdraw': tt(
                'transfer_jsx.withdraw_funds_after_the_required_3_day_waiting_period'
            ),
        };
        const powerTip3 = tt(
            'tips_js.converted_VESTING_TOKEN_can_be_sent_to_yourself_but_can_not_transfer_again',
            { LIQUID_TOKEN, VESTING_TOKEN }
        );
        const { to, amount, asset, memo } = this.state;
        const { loading, trxError, advanced } = this.state;
        const {
            currentUser,
            toVesting,
            transferToSelf,
            dispatchSubmit,
            tronAccountCheckError,
            tronTransferSubmit,
            trackingId,
            transferAsyncValidationLock,
        } = this.props;
        const { transferType } = this.props.initialValues;
        const { submitting, valid, handleSubmit } = this.state.transfer;
        // const isMemoPrivate = memo && /^#/.test(memo.value); -- private memos are not supported yet
        const isMemoPrivate = false;

        const tron_final_form = (
            // sign_complete_transfer
            <div>
                <div className="row">
                    <div className="column small-12">
                        {tt('transfer_jsx.sign_complete_transfer')}
                    </div>
                </div>
                <br />
                <div className="row">
                    <div className="column small-12">
                        <div
                            className="input-group"
                            style={{ marginBottom: '1.25rem' }}
                        >
                            <span className="input-group-label">@</span>
                            <input
                                className="input-group-field bold"
                                type="text"
                                disabled
                                value={currentUser.get('username')}
                            />
                            <span className="tron_address">
                                {' '}
                                {this.covertTronAddress(
                                    this.state.tron_address
                                )}
                            </span>
                        </div>
                    </div>
                </div>
                <div className="row">
                    <div className="column small-12">
                        <input
                            type="password"
                            placeholder={tt('g.input_tron_private_key')}
                            autoComplete="on"
                            autoCorrect="off"
                            autoCapitalize="off"
                            spellCheck="false"
                            onChange={e => {
                                this.setState({
                                    tronPrivateKey: e.target.value,
                                    show_transfer_button: true,
                                    tronLoading: false,
                                });
                                this.clearError();
                            }}
                        />
                    </div>
                </div>
                <div className="row">
                    <div className="column">
                        <br /> <br />
                        {this.state.tronLoading && (
                            <span>
                                <LoadingIndicator type="circle" />
                                <br />
                            </span>
                        )}
                        {trxError && <div className="error">{trxError}</div>}
                        <button
                            className="button"
                            onClick={() => {
                                this.setState({
                                    tronTransferStepTwo: true,
                                    tronPrivateKey: '',
                                    tronLoading: true,
                                });

                                tronTransferSubmit({
                                    currentUser,
                                    from: this.props.tronAddr,
                                    to: this.props.toTronAddr,
                                    amount: amount.value,
                                    memo: memo.value,
                                    privateKey: this.state.tronPrivateKey,
                                    errorCallback: this.errorCallback,
                                    trackingId,
                                });
                            }}
                            disabled={
                                !this.state.show_transfer_button ||
                                this.state.tronLoading
                            }
                        >
                            {tt('g.transfer')}
                        </button>
                        {!this.state.tronLoading && (
                            <button
                                type="button hollow"
                                className="button hollow"
                                style={{ float: 'right' }}
                                onClick={() => {
                                    this.setState({
                                        tronTransferStepTwo: false,
                                        tronTransferStepOne: true,
                                    });
                                }}
                            >
                                {tt('g.cancel')}
                            </button>
                        )}
                    </div>
                </div>
            </div>
        );
        const form = (
            <form
                onSubmit={handleSubmit(({ data }) => {
                    if (this.state.tronTransfer) {
                        // tron transfer
                        this.setState({
                            tronTransferStepOne: true,
                        });
                    } else {
                        // steem transfer
                        this.setState({ loading: true });
                        dispatchSubmit({
                            ...data,
                            errorCallback: this.errorCallback,
                            currentUser,
                            toVesting,
                            transferType,
                        });
                    }
                })}
                onChange={this.clearError}
            >
                {toVesting && (
                    <div className="row">
                        <div className="column small-12">
                            <p>{tt('tips_js.influence_token')}</p>
                            <p>
                                {tt('tips_js.non_transferable', {
                                    LIQUID_TOKEN,
                                    VESTING_TOKEN,
                                })}
                            </p>
                        </div>
                    </div>
                )}

                {!toVesting && (
                    <div>
                        <div className="row">
                            <div className="column small-12">
                                {transferTips[transferType]}
                            </div>
                        </div>
                        <br />
                    </div>
                )}

                <div className="row">
                    <div className="column small-2" style={{ paddingTop: 5 }}>
                        {tt('transfer_jsx.from')}
                    </div>
                    <div className="column small-10">
                        <div
                            className="input-group"
                            style={{ marginBottom: '1.25rem' }}
                        >
                            <span className="input-group-label">@</span>
                            <input
                                className="input-group-field bold"
                                type="text"
                                disabled
                                value={currentUser.get('username')}
                            />
                            {this.state.tronTransfer && (
                                <span className="tron_address">
                                    {' '}
                                    {this.covertTronAddress(
                                        this.props.tronAddr
                                    )}
                                </span>
                            )}
                        </div>
                    </div>
                </div>

                {advanced && (
                    <div className="row">
                        <div
                            className="column small-2"
                            style={{ paddingTop: 5 }}
                        >
                            {tt('transfer_jsx.to')}
                        </div>
                        <div className="column small-10">
                            <div
                                className="input-group"
                                style={{ marginBottom: '1.25rem' }}
                            >
                                {this.state.switchSteem && (
                                    <span className="input-group-label">@</span>
                                )}
                                <Autocomplete
                                    wrapperStyle={{
                                        display: 'inline-block',
                                        width: '100%',
                                    }}
                                    inputProps={{
                                        type: 'text',
                                        className: 'input-group-field',
                                        autoComplete: 'off',
                                        autoCorrect: 'off',
                                        autoCapitalize: 'off',
                                        spellCheck: 'false',
                                        disabled: loading,
                                    }}
                                    renderMenu={items => (
                                        <div
                                            className={`react-autocomplete-input ${items.length ===
                                                0 &&
                                                'react-autocomplete-input-no-data'}`}
                                        >
                                            {items}
                                        </div>
                                    )}
                                    ref={el => (this.to = el)}
                                    getItemValue={item => item.username}
                                    items={
                                        this.state.tronTransfer &&
                                        this.state.switchSteem
                                            ? this.state.autocompleteUsers
                                            : []
                                    }
                                    shouldItemRender={
                                        this.matchAutocompleteUser
                                    }
                                    renderItem={(item, isHighlighted) => (
                                        <div
                                            key={item.username}
                                            className={
                                                isHighlighted ? 'active' : ''
                                            }
                                        >
                                            {`${item.username} (${item.label})`}
                                        </div>
                                    )}
                                    value={this.state.to.value || ''}
                                    onChange={async e => {
                                        await this.onChangeTo(e.target.value);
                                    }}
                                    onSelect={async val => {
                                        await this.onChangeTo(val);
                                    }}
                                />
                                {this.state.tronTransfer &&
                                    this.state.switchSteem && (
                                        <div className="tron_address">
                                            {this.covertTronAddress(
                                                this.props.toTronAddr
                                            )}
                                        </div>
                                    )}
                            </div>
                            {this.state.tronTransfer &&
                                this.state.switchSteem && (
                                    <button
                                        className="switch"
                                        onClick={e => {
                                            this.setState({
                                                switchTron: true,
                                                switchSteem: false,
                                            });
                                            this.onChangeTo('');
                                            this.clearToTronInfo();
                                        }}
                                    >
                                        {tt('tron_jsx.switch_to_tron_account')}
                                    </button>
                                )}
                            {this.state.tronTransfer &&
                                this.state.switchTron && (
                                    <button
                                        className="switch"
                                        onClick={e => {
                                            this.setState({
                                                switchTron: false,
                                                switchSteem: true,
                                            });
                                            this.onChangeTo('');
                                            this.clearToTronInfo();
                                        }}
                                    >
                                        {tt('tron_jsx.switch_to_steem_account')}
                                    </button>
                                )}
                            {to.touched &&
                            (to.error || tronAccountCheckError) ? (
                                <div className="error">
                                    {to.error || tronAccountCheckError}&nbsp;
                                </div>
                            ) : (
                                <p>{toVesting && powerTip3}</p>
                            )}
                        </div>
                    </div>
                )}

                <div className="row">
                    <div className="column small-2" style={{ paddingTop: 5 }}>
                        {tt('g.amount')}
                    </div>
                    <div className="column small-10">
                        <div
                            className="input-group"
                            style={{ marginBottom: 5 }}
                        >
                            <input
                                type="text"
                                placeholder={tt('g.amount')}
                                {...amount.props}
                                ref="amount"
                                autoComplete="off"
                                autoCorrect="off"
                                autoCapitalize="off"
                                spellCheck="false"
                                disabled={loading}
                            />
                            {asset && (
                                <span
                                    className="input-group-label"
                                    style={{ paddingLeft: 0, paddingRight: 0 }}
                                >
                                    <select
                                        {...asset.props}
                                        placeholder={tt('transfer_jsx.asset')}
                                        disabled={
                                            loading || this.state.tronTransfer
                                        }
                                        style={{
                                            minWidth: '5rem',
                                            height: 'inherit',
                                            backgroundColor: 'transparent',
                                            border: 'none',
                                        }}
                                    >
                                        {!this.state.tronTransfer && (
                                            <option value="STEEM">STEEM</option>
                                        )}
                                        {!this.state.tronTransfer && (
                                            <option value="SBD">SBD</option>
                                        )}
                                        {this.state.tronTransfer && (
                                            <option value="TRX">TRX</option>
                                        )}
                                    </select>
                                </span>
                            )}
                        </div>
                        <div style={{ marginBottom: '0.6rem' }}>
                            <AssetBalance
                                balanceValue={this.balanceValue()}
                                onClick={this.assetBalanceClick}
                            />
                        </div>
                        {(asset && asset.touched && asset.error) ||
                        (amount.touched && amount.error) ? (
                            <div className="error">
                                {asset &&
                                    asset.touched &&
                                    asset.error &&
                                    asset.error}&nbsp;
                                {amount.touched &&
                                    amount.error &&
                                    amount.error}&nbsp;
                            </div>
                        ) : null}
                    </div>
                </div>

                {memo && (
                    <div className="row">
                        <div
                            className="column small-2"
                            style={{ paddingTop: 33 }}
                        >
                            {tt('g.memo')}
                        </div>
                        <div className="column small-10">
                            <small>
                                {isMemoPrivate
                                    ? tt('transfer_jsx.this_memo_is_private')
                                    : tt('transfer_jsx.this_memo_is_public')}
                            </small>
                            <input
                                type="text"
                                placeholder={tt('g.memo')}
                                {...memo.props}
                                ref="memo"
                                autoComplete="on"
                                autoCorrect="off"
                                autoCapitalize="off"
                                spellCheck="false"
                                disabled={loading}
                            />
                            <div className="error">
                                {memo.touched && memo.error && memo.error}&nbsp;
                            </div>
                        </div>
                    </div>
                )}
                <div className="row">
                    <div className="column">
                        {loading && (
                            <span>
                                {this.state.tronTransferStepOne ? (
                                    <button
                                        className="button"
                                        onClick={() =>
                                            this.setState({
                                                tronTransferStepTwo: true,
                                            })
                                        }
                                    >
                                        {tt('g.ok')}
                                    </button>
                                ) : (
                                    <LoadingIndicator type="circle" />
                                )}
                                <br />
                            </span>
                        )}
                        {!loading && (
                            <span>
                                {trxError && (
                                    <div className="error">{trxError}</div>
                                )}
                                <button
                                    type="submit"
                                    disabled={
                                        submitting ||
                                        !valid ||
                                        tronAccountCheckError !== null ||
                                        transferAsyncValidationLock > 0
                                    }
                                    className="button"
                                >
                                    {toVesting
                                        ? tt('g.power_up')
                                        : tt('g.next')}
                                </button>

                                {transferToSelf && (
                                    <button
                                        className="button hollow no-border"
                                        disabled={submitting}
                                        onClick={this.onAdvanced}
                                    >
                                        {advanced
                                            ? tt('g.basic')
                                            : tt('g.advanced')}
                                    </button>
                                )}
                            </span>
                        )}
                    </div>
                </div>
            </form>
        );

        const ConfirmTronTransfer = (
            <div className="info">
                <div key={`transaction-group-${0}`} className="input-group">
                    <span
                        key={`transaction-label-${0}`}
                        className="input-group-label"
                    >
                        from
                    </span>
                    <input
                        className="input-group-field"
                        type="text"
                        required
                        value={currentUser.get('username')}
                        disabled={true}
                        key={`transaction-input-${0}`}
                    />
                    <span className="tron_address">
                        {' '}
                        {this.covertTronAddress(this.props.tronAddr)}
                    </span>
                </div>
                <div key={`transaction-group-${1}`} className="input-group">
                    <span
                        key={`transaction-label-${1}`}
                        className="input-group-label"
                    >
                        to
                    </span>
                    <input
                        className="input-group-field"
                        type="text"
                        required
                        value={
                            this.state.switchSteem
                                ? to.value
                                : this.covertTronAddress(to.value)
                        }
                        disabled={true}
                        key={`transaction-input-${1}`}
                    />
                    {this.state.switchSteem && (
                        <span className="tron_address">
                            {this.covertTronAddress(this.props.toTronAddr)}
                        </span>
                    )}
                </div>
                <div key={`transaction-group-${2}`} className="input-group">
                    <span
                        key={`transaction-label-${2}`}
                        className="input-group-label"
                    >
                        amount
                    </span>
                    <input
                        className="input-group-field"
                        type="text"
                        required
                        value={
                            (amount && amount.value ? amount.value : 0) +
                            '  TRX'
                        }
                        disabled={true}
                        key={`transaction-input-${2}`}
                    />
                </div>
                <div key={`transaction-group-${3}`} className="input-group">
                    <span
                        key={`transaction-label-${3}`}
                        className="input-group-label"
                    >
                        memo
                    </span>
                    <input
                        className="input-group-field"
                        type="text"
                        required
                        value={memo && memo.value ? memo.value : ''}
                        disabled={true}
                        key={`transaction-input-${3}`}
                    />
                </div>
            </div>
        );
        const tron_confirm_modal = (
            <div>
                <br />
                {ConfirmTronTransfer}
                <br />
                <button
                    className="button"
                    onClick={() =>
                        this.setState({
                            tronTransferStepTwo: true,
                            tronTransferStepOne: false,
                        })
                    }
                >
                    {tt('g.ok')}
                </button>
                <button
                    type="button hollow"
                    className="button hollow"
                    style={{ float: 'right' }}
                    onClick={() => {
                        this.setState({
                            tronTransferStepTwo: false,
                            tronTransferStepOne: false,
                        });
                    }}
                >
                    {tt('g.cancel')}
                </button>
            </div>
        );
        return (
            <div>
                <div className="row">
                    {this.state.tronTransferStepOne ? (
                        <h3 className="column">
                            {tt('transfer_jsx.confirm_tron_transfer')}
                        </h3>
                    ) : (
                        <h3 className="column">
                            {toVesting
                                ? tt('transfer_jsx.convert_to_VESTING_TOKEN', {
                                      VESTING_TOKEN,
                                  })
                                : transferType}
                        </h3>
                    )}
                </div>
                {this.state.tronTransferStepOne
                    ? tron_confirm_modal
                    : this.state.tronTransferStepTwo
                        ? tron_final_form
                        : form}
            </div>
        );
    }
}

const AssetBalance = ({ onClick, balanceValue }) => (
    <a
        onClick={onClick}
        style={{ borderBottom: '#A09F9F 1px dotted', cursor: 'pointer' }}
    >
        {tt('g.balance', { balanceValue })}
    </a>
);

const TxLink = ({ txId, trackingId }) => (
    <div>
        <span>{tt('tron_jsx.transaction_send_success')}</span>
        <a
            onClick={() => {
                const new_window = window.open();
                const tron_host = $STM_Config.tron_host
                    ? $STM_Config.tron_host.toString()
                    : 'tronscan.org';
                if (tron_host && tron_host.includes('shasta')) {
                    new_window.location = `https://shasta.tronscan.org/#/transaction/${txId}`;
                } else {
                    new_window.location = `https://tronscan.org/#/transaction/${txId}`;
                }
                recordAdsView({
                    trackingId,
                    adTag: 'TronHistory',
                });
            }}
            style={{ paddingLeft: '10px' }}
        >
            {txId}
        </a>
    </div>
);

export default connect(
    // mapStateToProps
    (state, ownProps) => {
        const initialValues = state.user.get('transfer_defaults', Map()).toJS();
        const toVesting = initialValues.asset === 'VESTS';
        const currentUser = state.user.getIn(['current']);
        const currentAccount = state.global.getIn([
            'accounts',
            currentUser.get('username'),
        ]);

        if (!toVesting && !initialValues.transferType)
            initialValues.transferType = 'Transfer to Account';

        let transferToSelf =
            toVesting ||
            /Transfer to Savings|Savings Withdraw/.test(
                initialValues.transferType
            );
        if (transferToSelf && !initialValues.to)
            initialValues.to = currentUser.get('username');

        if (initialValues.to !== currentUser.get('username'))
            transferToSelf = false; // don't hide the to field
        const tronAddr =
            currentUser && currentUser.has('tron_addr')
                ? currentUser.get('tron_addr')
                : '';
        const tronBalance =
            currentUser && currentUser.has('tron_balance')
                ? currentUser.get('tron_balance')
                : 0;
        const toTronAddr = state.user.get('to_tron_addr');
        const tronAccountCheckError = state.user.has('tron_account_check_error')
            ? state.user.get('tron_account_check_error')
            : null;
        return {
            ...ownProps,
            trackingId: state.app.getIn(['trackingId'], null),
            currentUser,
            currentAccount,
            toVesting,
            transferToSelf,
            initialValues,
            following: state.global.getIn([
                'follow',
                'getFollowingAsync',
                currentUser.get('username'),
                'blog_result',
            ]),
            tronAddr,
            tronBalance,
            toTronAddr,
            tronAccountCheckError,
            transferAsyncValidationLock: state.app.has(
                'transferAsyncValidationLock'
            )
                ? state.app.get('transferAsyncValidationLock')
                : 0,
        };
    },

    // mapDispatchToProps
    dispatch => ({
        dispatchSubmit: ({
            to,
            amount,
            asset,
            memo,
            transferType,
            toVesting,
            currentUser,
            errorCallback,
        }) => {
            if (
                !toVesting &&
                !/Transfer to Account|Transfer to Savings|Savings Withdraw/.test(
                    transferType
                )
            )
                throw new Error(
                    `Invalid transfer params: toVesting ${toVesting}, transferType ${transferType}`
                );

            const username = currentUser.get('username');
            const successCallback = () => {
                // refresh transfer history
                dispatch(
                    globalActions.getState({ url: `@${username}/transfers` })
                );
                if (/Savings Withdraw/.test(transferType)) {
                    dispatch(userActions.loadSavingsWithdraw({}));
                }
                dispatch(userActions.hideTransfer());
            };
            const asset2 = toVesting ? 'STEEM' : asset;
            const operation = {
                from: username,
                to,
                amount: parseFloat(amount, 10).toFixed(3) + ' ' + asset2,
                memo: toVesting ? undefined : memo ? memo : '',
            };
            const confirm = () => <ConfirmTransfer operation={operation} />;
            if (transferType === 'Savings Withdraw')
                operation.request_id = Math.floor(
                    (Date.now() / 1000) % 4294967295
                );
            dispatch(
                transactionActions.broadcastOperation({
                    type: toVesting
                        ? 'transfer_to_vesting'
                        : transferType === 'Transfer to Account'
                            ? 'transfer'
                            : transferType === 'Transfer to Savings'
                                ? 'transfer_to_savings'
                                : transferType === 'Savings Withdraw'
                                    ? 'transfer_from_savings'
                                    : null,
                    operation,
                    successCallback,
                    errorCallback,
                    confirm,
                })
            );
        },
        tronTransferSubmit: ({
            currentUser,
            from,
            to,
            amount,
            memo,
            privateKey,
            errorCallback,
            trackingId,
        }) => {
            console.log('Tron Transfer:', from, to, amount, memo);
            const username = currentUser.get('username');
            const successCallback = result => {
                if (result.result !== true) {
                    console.error('tron transfer failed:', result);
                    errorCallback(result.code);
                    return;
                }
                // refresh transfer history
                dispatch(
                    globalActions.getState({ url: `@${username}/transfers` })
                );
                dispatch(userActions.hideTransfer());
                console.log(
                    `success finish tron transfer from ${from} to ${to}`,
                    result
                );
                dispatch(
                    appActions.addNotification({
                        key: 'chpwd_' + Date.now(),
                        message: (
                            <TxLink
                                txId={result.txid}
                                trackingId={trackingId}
                            />
                        ),
                        dismissAfter: 5000,
                    })
                );
            };
            dispatch(
                transactionActions.tronTransfer({
                    from,
                    to,
                    amount,
                    memo,
                    privateKey,
                    successCallback,
                    errorCallback,
                })
            );
        },
        checkTron: (from, to, type) => {
            dispatch(userActions.checkTron({ from, to, type }));
        },
        setToTronAddr: tronAddr => {
            // this method is for the tron transfer when user uses tron address as the 'to' address.
            dispatch(userActions.setToTronAddr(tronAddr));
        },
        lockTransferAsyncValidation: () =>
            dispatch(appActions.lockTransferAsyncValidation()),
        unlockTransferAsyncValidation: () =>
            dispatch(appActions.unlockTransferAsyncValidation()),
    })
)(TransferForm);
