import React, { Component } from 'react';
import tt from 'counterpart';
import { connect } from 'react-redux';
import * as userActions from 'app/redux/UserReducer';
import PdfDownload from 'app/components/elements/PdfDownload';
const styles = {
    step: {
        marginTop: '12px',
        marginLeft: '10%',
        frontSize: '20px',
    },
};

/*
    "update_tron_account":"UPDATE TRON ACCOUNT",
        "update_tron_content":"To update TRON account, please confirm following information so as to avoid potential risk. \n Save TRON private key locally or import this TRON account into other wallet supporting TRON. or transfer tron asset into other tron account. ",
        "update_button":"UPDATE AND DOWNLOAD",
        "update_success": "UPDATE SUCCESS",
        "update_success_content":" You successfully update your TRON account. If fail to download, please with TRON public key pdf file. please take care of this file, if loss, cannot get it back. please do not share with anyone",
        "update_success_click": "click download" 
         "safe_save_button":"safe save"
*/

class UpdateTronAccountTwo extends Component {
    constructor() {
        super();
        this.handleSubmit = e => {
            e.preventDefault();
            this.props.hideUpdateSuccess();
        };
    }

    render() {
        console.log('update second step ');
        const tron_address = sessionStorage.getItem('tron_address');
        const tron_key = sessionStorage.getItem('tron_private_key');
        const username = sessionStorage.getItem('username');
        return (
            <div>
                <div>
                    <h1>{tt('tron_jsx.update_tron_success')}</h1>
                </div>
                <div>
                    {tt('tron_jsx.update_success_content')}

                    <PdfDownload
                        name={username}
                        tron_address={tron_address}
                        tron_key={tron_key}
                        newUser={false}
                        widthInches={8.5}
                        heightInches={11.0}
                        label="Download a PDF with keys and instructions"
                    />
                </div>
                <button
                    type="submit"
                    className="button"
                    onClick={this.handleSubmit}
                >
                    {tt('tron_jsx.safe_save_button')}
                </button>
            </div>
        );
    }
}

export default connect(
    state => ({}),
    dispatch => ({
        hideUpdateSuccess: () => {
            // if (e) e.preventDefault();
            dispatch(userActions.hideUpdateSuccess());
        },
    })
)(UpdateTronAccountTwo);
