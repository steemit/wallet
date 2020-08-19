import React, { Component } from 'react';
import tt from 'counterpart';
import { connect } from 'react-redux';
import * as userActions from 'app/redux/UserReducer';
const styles = {
    container: {
        display: 'flex',
        flexDirection: 'row',
        flexFlow: 'row wrap',
        marginTop: '40px',
    },
    flowBelow: {
        marginTop: '40px',
    },
};
class UpdateTronAccountOne extends Component {
    constructor() {
        super();
        this.handleSubmit = e => {
            e.preventDefault();
            this.props.hideUpdate();
            this.props.showUpdateSuccess();
            this.props.updateUser();
        };
    }

    render() {
        return (
            <div>
                <div>
                    <h3>{tt('tron_jsx.update_tron_account')}</h3>
                </div>
                <div style={styles.container}>
                    {tt('tron_jsx.update_tron_content')}
                </div>
                <div style={styles.flowBelow}>
                    <button
                        type="submit"
                        className="button"
                        onClick={this.handleSubmit}
                    >
                        {tt('tron_jsx.update_button')}
                    </button>
                </div>
            </div>
        );
    }
}

export default connect(
    state => ({}),
    dispatch => ({
        showUpdateSuccess: () => {
            // if (e) e.preventDefault();
            // dispatch(userActions.hideUpdate());
            dispatch(userActions.showUpdateSuccess());
        },
        hideUpdate: () => {
            dispatch(userActions.hideUpdate());
        },
        updateUser: () => {
            dispatch(
                userActions.updateUser({
                    claim_reward: false,
                    tron_address: '',
                })
            );
        },
    })
)(UpdateTronAccountOne);
